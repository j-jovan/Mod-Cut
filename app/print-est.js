// Print analysis: support estimation by height-map ray casting + auto orientation.
// Pure JS (no wasm) so it can run in a worker or in Node tests.

// 6 "face-down" rotations (row-major 3x3, v' = R v). Each puts one bounding-box side on the bed.
export const BASE_ROTS = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1],    // -Z down (as modelled)
  [1, 0, 0, 0, -1, 0, 0, 0, -1],  // +Z down (upside down)
  [1, 0, 0, 0, 0, -1, 0, 1, 0],   // -Y down (front face on bed)
  [1, 0, 0, 0, 0, 1, 0, -1, 0],   // +Y down (back face on bed)
  [0, 0, -1, 0, 1, 0, 1, 0, 0],   // -X down (left face on bed)
  [0, 0, 1, 0, 1, 0, -1, 0, 0],   // +X down (right face on bed)
];
export const ROT_Z90 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
export function mul3(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
}

function rotate(vert, R) {
  const n = vert.length / 3; const out = new Float32Array(vert.length);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const x = vert[i * 3], y = vert[i * 3 + 1], z = vert[i * 3 + 2];
    for (let a = 0; a < 3; a++) {
      const v = R[a * 3] * x + R[a * 3 + 1] * y + R[a * 3 + 2] * z;
      out[i * 3 + a] = v; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v;
    }
  }
  return { p: out, min: mn, max: mx };
}

/**
 * Support analysis of a mesh in a given orientation.
 * Casts a vertical ray through every grid cell, collects surface hits and finds
 * overhang surfaces (flatter than the threshold) that have air below them.
 * Support for each such hit runs down to the next up-facing surface below, or the bed.
 */
export function analyzeOrientation(vert, tri, R, opts = {}) {
  const angle = opts.overhangAngle ?? 45;  // slicer-style threshold: faces flatter than this (from horizontal) need support
  const thr = -Math.cos(angle * Math.PI / 180); // down-facing normal z below this needs support
  const { p, min, max } = rotate(vert, R);
  const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const cell = opts.cell || Math.max(0.6, Math.max(dims[0], dims[1]) / (opts.res || 140));
  const nx = Math.max(1, Math.ceil(dims[0] / cell)), ny = Math.max(1, Math.ceil(dims[1] / cell));
  const hitsZ = new Array(nx * ny); const hitsF = new Array(nx * ny);
  const ntri = tri.length / 3;
  for (let t = 0; t < ntri; t++) {
    const ia = tri[t * 3] * 3, ib = tri[t * 3 + 1] * 3, ic = tri[t * 3 + 2] * 3;
    const ax = p[ia], ay = p[ia + 1], az = p[ia + 2], bx = p[ib], by = p[ib + 1], bz = p[ib + 2], cx = p[ic], cy = p[ic + 1], cz = p[ic + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const Nx = uy * vz - uz * vy, Ny = uz * vx - ux * vz, Nz = ux * vy - uy * vx;
    const len = Math.hypot(Nx, Ny, Nz); if (len < 1e-12) continue;
    const nz = Nz / len;
    if (Math.abs(nz) < 1e-4) continue; // vertical wall: no vertical-ray hits
    const flag = nz > 0 ? 1 : (nz < thr ? -2 : -1);
    const det = ux * vy - uy * vx; if (Math.abs(det) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - min[0]) / cell - 0.5));
    const x1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - min[0]) / cell - 0.5));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - min[1]) / cell - 0.5));
    const y1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - min[1]) / cell - 0.5));
    for (let i = x0; i <= x1; i++) {
      const px = min[0] + (i + 0.5) * cell;
      for (let j = y0; j <= y1; j++) {
        const py = min[1] + (j + 0.5) * cell;
        const wx = px - ax, wy = py - ay;
        const s = (wx * vy - wy * vx) / det, q = (ux * wy - uy * wx) / det;
        if (s < -1e-9 || q < -1e-9 || s + q > 1 + 1e-9) continue;
        const z = az + s * uz + q * vz;
        const k = i * ny + j;
        if (!hitsZ[k]) { hitsZ[k] = []; hitsF[k] = []; }
        hitsZ[k].push(z); hitsF[k].push(flag);
      }
    }
  }
  const area = cell * cell; const bedTol = Math.max(0.3, cell * 0.25);
  let supportVol = 0, contact = 0;
  const cols = opts.columns ? [] : null;
  for (let k = 0; k < hitsZ.length; k++) {
    const zs = hitsZ[k]; if (!zs) continue;
    const fs = hitsF[k];
    const order = zs.map((_, i) => i).sort((a, b) => zs[a] - zs[b]);
    for (let oi = 0; oi < order.length; oi++) {
      const h = order[oi];
      if (fs[h] !== -2) continue;
      const z = zs[h];
      if (z - min[2] < bedTol) continue; // sits on the bed
      // nearest up-facing surface below
      let base = min[2];
      for (let oj = oi - 1; oj >= 0; oj--) { const g = order[oj]; if (zs[g] < z - 1e-6 && fs[g] === 1) { base = zs[g]; break; } }
      const hgt = z - base; if (hgt < 0.2) continue;
      supportVol += area * hgt; contact += area;
      if (cols) { const i = Math.floor(k / ny), j = k % ny; cols.push(min[0] + (i + 0.5) * cell, min[1] + (j + 0.5) * cell, base, z); }
    }
  }
  return { dims, min, max, supportVol, contact, cell, columns: cols ? new Float32Array(cols) : null };
}

export function analyzePart(vert, tri, opts = {}) {
  return BASE_ROTS.map((R) => {
    const r = analyzeOrientation(vert, tri, R, opts);
    return { R, dims: r.dims, supportVol: r.supportVol, contact: r.contact };
  });
}

/** Filament estimate for one part (FDM). Volumes in mm³, areas in mm². */
export function filamentFor(part, sup, s) {
  const V = part.volume, A = part.area;
  if (!Number.isFinite(V)) return null;
  const shellT = Math.max(s.walls * s.lineWidth, s.topBottom);
  const shell = Math.min(V * 0.98, A * shellT * 0.92);
  const infill = Math.max(0, V - shell) * (s.infill / 100) * (PATTERN_FACTOR[s.pattern] || 1);
  let support = 0;
  if (s.supports && sup) support = sup.supportVol * (s.supportDensity / 100) + sup.contact * s.interfaceT * 0.7;
  const model = shell + infill;
  const total = model + support;
  return { shell, infill, support, model, total };
}
// relative material vs. rectilinear at the same nominal density
export const PATTERN_FACTOR = { rectilinear: 1.0, grid: 1.0, gyroid: 1.03, honeycomb: 1.12, cubic: 1.0, lightning: 0.45 };
