// ModCut geometry core — runs inside a Web Worker (and in Node for tests).
// Uses manifold-3d for watertight boolean cuts with capped faces.

let W = null; // manifold wasm module
export function initCore(wasm) { W = wasm; }

/* ---------------------------------------------------------------- welding */
// Merge coincident vertices of a (possibly unindexed) triangle soup.
export function weld(positions, index, tol) {
  const nIn = positions.length / 3;
  const triIdx = index || null;
  const triCount = triIdx ? triIdx.length / 3 : nIn / 3;
  const inv = 1 / tol;
  // open-addressing hash table
  let cap = 1; while (cap < nIn * 2) cap <<= 1;
  const keysX = new Int32Array(cap), keysY = new Int32Array(cap), keysZ = new Int32Array(cap);
  const slot = new Int32Array(cap).fill(-1);
  const remap = new Uint32Array(nIn);
  const out = new Float32Array(nIn * 3);
  let nOut = 0;
  for (let i = 0; i < nIn; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const qx = Math.round(x * inv), qy = Math.round(y * inv), qz = Math.round(z * inv);
    let h = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) & (cap - 1);
    while (true) {
      const s = slot[h];
      if (s === -1) {
        slot[h] = nOut; keysX[h] = qx; keysY[h] = qy; keysZ[h] = qz;
        out[nOut * 3] = x; out[nOut * 3 + 1] = y; out[nOut * 3 + 2] = z;
        remap[i] = nOut++; break;
      }
      if (keysX[h] === qx && keysY[h] === qy && keysZ[h] === qz) { remap[i] = s; break; }
      h = (h + 1) & (cap - 1);
    }
  }
  const tris = new Uint32Array(triCount * 3);
  let t = 0;
  for (let f = 0; f < triCount; f++) {
    const a = remap[triIdx ? triIdx[f * 3] : f * 3];
    const b = remap[triIdx ? triIdx[f * 3 + 1] : f * 3 + 1];
    const c = remap[triIdx ? triIdx[f * 3 + 2] : f * 3 + 2];
    if (a === b || b === c || a === c) continue; // degenerate
    tris[t++] = a; tris[t++] = b; tris[t++] = c;
  }
  return { vert: out.slice(0, nOut * 3), tri: tris.slice(0, t) };
}

function diagOf(p) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = p[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
  }
  return Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
}

// Try to build a Manifold from one mesh, with progressively looser welding.
function buildOne(positions, index) {
  const d = diagOf(positions);
  let lastStatus = 'unknown';
  for (const f of [1e-6, 1e-5, 1e-4, 5e-4]) {
    const { vert, tri } = weld(positions, index, Math.max(d * f, 1e-7));
    if (tri.length === 0) return { man: null, status: 'empty' };
    try {
      const mesh = new W.Mesh({ numProp: 3, vertProperties: vert, triVerts: tri });
      mesh.merge();
      const man = new W.Manifold(mesh);
      const st = man.status();
      if (st === 'NoError' && !man.isEmpty()) {
        // inside-out meshes produce negative volume — flip
        if (man.volume() < 0) { man.delete(); continue; }
        return { man, status: 'ok' };
      }
      lastStatus = st; man.delete();
    } catch (e) { lastStatus = String(e.message || e); }
  }
  // Last attempt: flipped winding (inside-out models)
  try {
    const { vert, tri } = weld(positions, index, Math.max(d * 1e-5, 1e-7));
    for (let i = 0; i < tri.length; i += 3) { const t = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = t; }
    const mesh = new W.Mesh({ numProp: 3, vertProperties: vert, triVerts: tri });
    mesh.merge();
    const man = new W.Manifold(mesh);
    if (man.status() === 'NoError' && !man.isEmpty() && man.volume() > 0) return { man, status: 'flipped' };
    man.delete();
  } catch (e) { /* ignore */ }
  return { man: null, status: lastStatus };
}

/* ----------------------------------------------------------------- state */
let base = null;          // Manifold (watertight path)
let soup = null;          // {positions:Float32Array} fallback path
export function loadModel(meshes) {
  if (base) { base.delete(); base = null; }
  soup = null;
  const parts = []; const failed = [];
  let triTotal = 0;
  for (const m of meshes) {
    triTotal += m.index ? m.index.length / 3 : m.positions.length / 9;
    const r = buildOne(m.positions, m.index);
    if (r.man) parts.push(r.man); else failed.push(r.status);
  }
  if (parts.length && failed.length === 0) {
    base = parts.length === 1 ? parts[0] : W.Manifold.union(parts);
    if (parts.length > 1) parts.forEach(p => p.delete());
    return { watertight: true, volume: base.volume(), triCount: triTotal, objects: meshes.length };
  }
  parts.forEach(p => p.delete());
  // Fallback: keep raw triangles, cut faces will be open.
  let n = 0; for (const m of meshes) n += m.index ? m.index.length * 3 : m.positions.length;
  const pos = new Float32Array(n); let o = 0;
  for (const m of meshes) {
    if (m.index) for (let i = 0; i < m.index.length; i++) { const v = m.index[i] * 3; pos[o++] = m.positions[v]; pos[o++] = m.positions[v + 1]; pos[o++] = m.positions[v + 2]; }
    else { pos.set(m.positions, o); o += m.positions.length; }
  }
  soup = { positions: pos };
  return { watertight: false, reason: failed[0], triCount: triTotal, objects: meshes.length };
}

/* ------------------------------------------------------ 2D helper geometry */
function pointInPolys(px, py, polys) {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
  }
  return inside;
}
function distToPolys(px, py, polys) {
  let best = Infinity;
  for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
    const dx = bx - ax, dy = by - ay; const l = dx * dx + dy * dy;
    let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); if (d < best) best = d;
  }
  return best;
}

// Choose connector centres inside an (already eroded) region.
function pickPoints(cs, maxCount, minSpacing) {
  const pts = [];
  const islands = cs.decompose();
  for (const isl of islands) {
    const area = isl.area();
    if (area <= 1e-6) { isl.delete(); continue; }
    const polys = isl.toPolygons();
    const b = isl.bounds();
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
    const step = Math.max(Math.sqrt((w * h) / 1600), 0.25);
    const cand = [];
    for (let x = b.min[0] + step / 2; x <= b.max[0]; x += step)
      for (let y = b.min[1] + step / 2; y <= b.max[1]; y += step)
        if (pointInPolys(x, y, polys)) cand.push([x, y, distToPolys(x, y, polys)]);
    if (!cand.length) { // tiny island: use bounds centre
      pts.push([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]); isl.delete(); continue;
    }
    // how many in this island: scale with size
    const want = Math.max(1, Math.min(maxCount, Math.round(Math.sqrt(area) / (minSpacing * 1.6))));
    const chosen = [];
    // first: deepest point (most material around it)
    cand.sort((a, c) => c[2] - a[2]);
    if (want === 1) chosen.push(cand[0]);
    else {
      // spread: farthest-point sampling seeded by deepest point, weighted by depth
      chosen.push(cand[0]);
      while (chosen.length < want) {
        let bestC = null, bestS = -1;
        for (const c of cand) {
          let dmin = Infinity; for (const q of chosen) dmin = Math.min(dmin, Math.hypot(c[0] - q[0], c[1] - q[1]));
          if (dmin < minSpacing) continue;
          const s = dmin + c[2] * 0.5;
          if (s > bestS) { bestS = s; bestC = c; }
        }
        if (!bestC) break; chosen.push(bestC);
      }
    }
    for (const c of chosen) pts.push([c[0], c[1]]);
    isl.delete();
  }
  return pts;
}

/* -------------------------------------------------------------- cutting */
// axis permutations so that slice() (which is along Z) can section on any axis.
// axis 0 (X): new = (y, z, x)  -> 2D coords are (y, z)
// axis 1 (Y): new = (z, x, y)  -> 2D coords are (z, x)
// axis 2 (Z): identity          -> 2D coords are (x, y)
const PERM = [
  [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1], // column-major: x'=y, y'=z, z'=x
  [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1], // x'=z, y'=x, z'=y
  null,
];
function to3D(axis, a, b, pos) {
  if (axis === 0) return [pos, a, b];
  if (axis === 1) return [b, pos, a];
  return [a, b, pos];
}
function rect2D(axis, lo, hi) { // lo/hi are 3D cell bounds, returns 2D rect in section coords
  const ax = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
  return [[lo[ax[0]], lo[ax[1]]], [hi[ax[0]], hi[ax[1]]]];
}
function cylAlong(axis, len, r, seg, centre, offset = 0) {
  // cylinder of length len starting at plane (offset along axis), centred on point
  let c = W.Manifold.cylinder(len, r, r, seg, false).translate([0, 0, offset]);
  if (axis === 0) c = c.rotate([0, 90, 0]);      // z -> x
  else if (axis === 1) c = c.rotate([-90, 0, 0]); // z -> y
  return c.translate(centre);
}
function pegAlong(axis, len, r, seg, centre, dir) {
  // peg protruding from plane in direction dir (+1/-1), with chamfered tip
  const ch = Math.min(r * 0.35, len * 0.3, 0.8);
  let body = W.Manifold.cylinder(len - ch, r, r, seg, false);
  const tip = W.Manifold.cylinder(ch, r, Math.max(r - ch, r * 0.4), seg, false).translate([0, 0, len - ch]);
  let p = body.add(tip);
  if (dir < 0) p = p.mirror([0, 0, 1]);
  if (axis === 0) p = p.rotate([0, 90, 0]);
  else if (axis === 1) p = p.rotate([-90, 0, 0]);
  return p.translate(centre);
}

function meshOut(man) {
  const m = man.getMesh();
  const np = m.numProp;
  let vp = m.vertProperties;
  if (np !== 3) { const n = vp.length / np; const o = new Float32Array(n * 3); for (let i = 0; i < n; i++) { o[i * 3] = vp[i * np]; o[i * 3 + 1] = vp[i * np + 1]; o[i * 3 + 2] = vp[i * np + 2]; } vp = o; }
  else vp = new Float32Array(vp);
  return { vert: vp, tri: new Uint32Array(m.triVerts) };
}

/**
 * job = {matrix:[16], cuts:[[x...],[y...],[z...]], bounds:{min,max},
 *        connector:{type:'none'|'dowel'|'peg', diameter, depth, tolerance, wall, maxPerFace, segments},
 *        separateIslands, minIslandVolume}
 */
export function cutModel(job, progress = () => {}) {
  if (!base && !soup) throw new Error('No model loaded');
  if (!base) return cutSoup(job, progress);
  const t0 = Date.now();
  const model = base.transform(job.matrix);
  const bmin = job.bounds.min, bmax = job.bounds.max;
  const pad = 1; // cell outer bounds padded beyond model
  const edges = [0, 1, 2].map(a => [bmin[a] - pad, ...job.cuts[a].slice().sort((p, q) => p - q), bmax[a] + pad]);
  const conn = job.connector || { type: 'none' };
  const warnings = [];

  // ---- connector placement (holes/pegs) on each interface
  const holesAll = [];     // dowel mode: subtracted from whole model before splitting
  const pegAdds = new Map();  // cellKey -> [Manifold]
  const pegSubs = new Map();  // cellKey -> [Manifold]
  const connectorList = [];
  const key = (i, j, k) => `${i},${j},${k}`;
  if (conn.type !== 'none' && conn.diameter > 0) {
    const r = conn.diameter / 2, tol = conn.tolerance, depth = conn.depth, wall = conn.wall;
    const seg = conn.segments || 32;
    const permuted = [0, 1, 2].map(a => PERM[a] ? model.transform(PERM[a]) : model);
    const secCache = new Map();
    const section = (a, pos) => {
      const k = a + ':' + pos.toFixed(5);
      if (!secCache.has(k)) secCache.set(k, permuted[a].slice(pos));
      return secCache.get(k);
    };
    let ifaceTotal = 0;
    for (let a = 0; a < 3; a++) ifaceTotal += (edges[a].length - 2);
    let ifaceDone = 0;
    for (let a = 0; a < 3; a++) {
      const b1 = (a + 1) % 3, b2 = (a + 2) % 3;
      for (let ci = 1; ci < edges[a].length - 1; ci++) {
        const pos = edges[a][ci];
        progress('Placing connectors', ++ifaceDone / Math.max(ifaceTotal, 1) * 0.3);
        const lowThick = pos - edges[a][ci - 1], highThick = edges[a][ci + 1] - pos;
        // effective depth limited by slab thickness
        const dHole = Math.min(depth + tol, highThick - wall, conn.type === 'dowel' ? lowThick - wall : Infinity);
        if (dHole < Math.min(3, depth * 0.4)) { warnings.push(`Cut ${'XYZ'[a]}=${pos.toFixed(1)}: slab too thin for connectors`); continue; }
        const dEff = dHole - tol;
        const s0 = section(a, pos);
        const sHi = section(a, pos + dHole);
        let region = s0.intersect(sHi);
        if (conn.type === 'dowel') { const sLo = section(a, pos - dHole); const r2 = region.intersect(sLo); region.delete(); region = r2; }
        // iterate cells over the 2 other axes
        for (let i = 0; i < edges[b1].length - 1; i++) for (let j = 0; j < edges[b2].length - 1; j++) {
          const lo = [0, 0, 0], hi = [0, 0, 0];
          lo[b1] = edges[b1][i]; hi[b1] = edges[b1][i + 1];
          lo[b2] = edges[b2][j]; hi[b2] = edges[b2][j + 1];
          const [r0, r1] = rect2D(a, lo, hi);
          const sq = W.CrossSection.square([r1[0] - r0[0], r1[1] - r0[1]]).translate(r0);
          const cell = region.intersect(sq);
          const eroded = cell.offset(-(r + tol + wall), 'Round');
          const pts = eroded.isEmpty() ? [] : pickPoints(eroded, conn.maxPerFace || 2, conn.diameter * 3);
          sq.delete(); cell.delete(); eroded.delete();
          if (!pts.length) continue;
          // cell indices on low and high side
          const idxLow = [0, 0, 0], idxHigh = [0, 0, 0];
          idxLow[a] = ci - 1; idxHigh[a] = ci; idxLow[b1] = idxHigh[b1] = i; idxLow[b2] = idxHigh[b2] = j;
          for (const [u, v] of pts) {
            const c3 = to3D(a, u, v, pos);
            connectorList.push({ axis: a, at: c3, type: conn.type, depth: dHole });
            if (conn.type === 'dowel') {
              holesAll.push(cylAlong(a, 2 * dHole, r + tol, seg, c3, -dHole));
            } else {
              const kL = key(...idxLow), kH = key(...idxHigh);
              if (!pegAdds.has(kL)) pegAdds.set(kL, []);
              if (!pegSubs.has(kH)) pegSubs.set(kH, []);
              pegAdds.get(kL).push(pegAlong(a, dEff - 0.2, r, seg, c3, +1));
              pegSubs.get(kH).push(cylAlong(a, dHole, r + tol, seg, c3, 0));
            }
          }
        }
        region.delete();
      }
    }
    for (const s of secCache.values()) s.delete();
    permuted.forEach((p, a) => { if (PERM[a]) p.delete(); });
  }

  let work = model;
  if (holesAll.length) {
    progress('Drilling dowel holes', 0.32);
    const u = W.Manifold.union(holesAll); holesAll.forEach(h => h.delete());
    work = model.subtract(u); u.delete();
  }

  // ---- split into slabs along each axis
  progress('Cutting', 0.35);
  const splitAxis = (pieces, a) => {
    const out = [];
    for (const { man, idx } of pieces) {
      let rest = man;
      const cuts = edges[a].slice(1, -1);
      for (let c = 0; c < cuts.length; c++) {
        const n = [0, 0, 0]; n[a] = 1;
        const [above, below] = rest.splitByPlane(n, cuts[c]);
        const id = idx.slice(); id[a] = c;
        out.push({ man: below, idx: id });
        if (rest !== man) rest.delete();
        rest = above;
      }
      const id = idx.slice(); id[a] = cuts.length;
      out.push({ man: rest, idx: id });
    }
    return out;
  };
  let pieces = [{ man: work, idx: [0, 0, 0] }];
  for (let a = 0; a < 3; a++) {
    const next = splitAxis(pieces, a);
    // free intermediates (not the original model handle)
    for (const p of pieces) if (!next.some(n => n.man === p.man)) p.man.delete();
    pieces = next;
  }
  if (work !== model) model.delete();

  // ---- apply pegs, collect output
  const parts = [];
  let n = 0;
  for (const p of pieces) {
    n++;
    progress('Finishing parts', 0.4 + 0.6 * n / pieces.length);
    let m = p.man;
    if (m.isEmpty()) { m.delete(); continue; }
    const k = key(...p.idx);
    if (pegSubs.has(k)) { const u = W.Manifold.union(pegSubs.get(k)); const m2 = m.subtract(u); m.delete(); u.delete(); m = m2; pegSubs.get(k).forEach(x => x.delete()); }
    if (pegAdds.has(k)) { const u = W.Manifold.union(pegAdds.get(k)); const m2 = m.add(u); m.delete(); u.delete(); m = m2; pegAdds.get(k).forEach(x => x.delete()); }
    const islands = job.separateIslands ? m.decompose() : [m];
    if (job.separateIslands) m.delete();
    islands.forEach((isl, ii) => {
      const vol = isl.volume();
      if (vol < (job.minIslandVolume ?? 1)) { isl.delete(); return; }
      const bb = isl.boundingBox();
      parts.push({ cell: p.idx, island: islands.length > 1 ? ii + 1 : 0, volume: vol, area: isl.surfaceArea(), bbox: { min: bb.min, max: bb.max }, ...meshOut(isl), watertight: true });
      isl.delete();
    });
  }
  // leftover connector manifolds for cells that ended empty
  for (const arr of [...pegAdds.values(), ...pegSubs.values()]) arr.forEach(x => { try { x.delete(); } catch (e) {} });
  return { parts, connectors: connectorList, warnings, ms: Date.now() - t0 };
}

/* ------------------------------------------------ fallback: open clipping */
function cutSoup(job, progress) {
  const t0 = Date.now();
  const M = job.matrix; const src = soup.positions;
  const P = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    P[i] = M[0] * x + M[4] * y + M[8] * z + M[12];
    P[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
    P[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
  }
  const bmin = job.bounds.min, bmax = job.bounds.max;
  const edges = [0, 1, 2].map(a => [bmin[a] - 1, ...job.cuts[a].slice().sort((p, q) => p - q), bmax[a] + 1]);
  const parts = [];
  const nCells = (edges[0].length - 1) * (edges[1].length - 1) * (edges[2].length - 1);
  let done = 0;
  const clip = (poly, a, v, keepAbove) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const dp = keepAbove ? p[a] - v : v - p[a], dq = keepAbove ? q[a] - v : v - q[a];
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])]); }
    }
    return out;
  };
  for (let i = 0; i < edges[0].length - 1; i++) for (let j = 0; j < edges[1].length - 1; j++) for (let k = 0; k < edges[2].length - 1; k++) {
    progress('Clipping (open mesh)', ++done / nCells);
    const lo = [edges[0][i], edges[1][j], edges[2][k]], hi = [edges[0][i + 1], edges[1][j + 1], edges[2][k + 1]];
    const out = [];
    for (let t = 0; t < P.length; t += 9) {
      let poly = [[P[t], P[t + 1], P[t + 2]], [P[t + 3], P[t + 4], P[t + 5]], [P[t + 6], P[t + 7], P[t + 8]]];
      let skip = false;
      for (let a = 0; a < 3 && !skip; a++) {
        const mn = Math.min(poly[0][a], poly[1][a], poly[2][a]), mx = Math.max(poly[0][a], poly[1][a], poly[2][a]);
        if (mx < lo[a] || mn > hi[a]) skip = true;
      }
      if (skip) continue;
      for (let a = 0; a < 3 && poly.length >= 3; a++) { poly = clip(poly, a, lo[a], true); if (poly.length >= 3) poly = clip(poly, a, hi[a], false); }
      for (let q = 1; q + 1 < poly.length; q++) out.push(...poly[0], ...poly[q], ...poly[q + 1]);
    }
    if (out.length < 9) continue;
    const vert = new Float32Array(out);
    const tri = new Uint32Array(vert.length / 3).map((_, x) => x);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let q = 0; q < vert.length; q += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], vert[q + a]); mx[a] = Math.max(mx[a], vert[q + a]); }
    parts.push({ cell: [i, j, k], island: 0, volume: NaN, area: NaN, bbox: { min: mn, max: mx }, vert, tri, watertight: false });
  }
  return { parts, connectors: [], warnings: ['Model is not watertight: parts were clipped without capping. Repair the model for closed cut faces and connectors.'], ms: Date.now() - t0 };
}
