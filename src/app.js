import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js';
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js';
import { BASE_ROTS, ROT_Z90, mul3, filamentFor } from '../app/print-est.js';

const $ = (id) => document.getElementById(id);
const AXES = ['X', 'Y', 'Z'];
const AXCOL = [0xff5d5d, 0x5ed47a, 0x5aa2ff];
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/* ------------------------------------------------------------ presets */
const PRESETS = [
  { name: 'Anycubic Photon Mono M7 Max', x: 298, y: 164, z: 300, tech: 'resin' },
  { name: 'Anycubic Photon Mono M7 Pro', x: 223, y: 126, z: 230, tech: 'resin' },
  { name: 'Elegoo Saturn 4 Ultra', x: 218, y: 123, z: 220, tech: 'resin' },
  { name: 'Bambu Lab X1C / P1S / A1', x: 256, y: 256, z: 256, tech: 'fdm' },
  { name: 'Bambu Lab A1 mini', x: 180, y: 180, z: 180, tech: 'fdm' },
  { name: 'Prusa MK4 / MK4S', x: 250, y: 210, z: 220, tech: 'fdm' },
  { name: 'Prusa CORE One', x: 250, y: 220, z: 270, tech: 'fdm' },
  { name: 'Prusa XL', x: 360, y: 360, z: 360, tech: 'fdm' },
  { name: 'Creality Ender-3 V3 / K1', x: 220, y: 220, z: 250, tech: 'fdm' },
  { name: 'Creality K1 Max', x: 300, y: 300, z: 300, tech: 'fdm' },
  { name: 'Elegoo Neptune 4 Max', x: 420, y: 420, z: 480, tech: 'fdm' },
  { name: 'Anycubic Kobra 2 Max', x: 420, y: 420, z: 500, tech: 'fdm' },
  { name: 'Voron 2.4 (350)', x: 350, y: 350, z: 340, tech: 'fdm' },
];
const MATERIALS = [
  { name: 'PLA', d: 1.24, tech: 'fdm' }, { name: 'PETG', d: 1.27, tech: 'fdm' }, { name: 'ABS', d: 1.04, tech: 'fdm' },
  { name: 'ASA', d: 1.07, tech: 'fdm' }, { name: 'TPU', d: 1.21, tech: 'fdm' }, { name: 'PLA-CF', d: 1.3, tech: 'fdm' },
  { name: 'Standard resin', d: 1.15, tech: 'resin' }, { name: 'ABS-like resin', d: 1.12, tech: 'resin' }, { name: 'Tough resin', d: 1.17, tech: 'resin' },
];

const store = {
  get(k, d) { try { const v = localStorage.getItem('modcut.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('modcut.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

/* --------------------------------------------------------------- state */
const S = {
  printer: store.get('printer', null),
  model: null, // {name, meshes, geom, watertight, triCount, rb:{min,max}}
  units: 1,
  sv: [1, 1, 1],
  lock: true,
  rot: new THREE.Matrix4(),
  mir: [1, 1, 1],
  M: new THREE.Matrix4(),
  size: [0, 0, 0],
  bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  layout: 'auto',
  counts: [1, 1, 1],
  cuts: [[], [], []],
  conn: 'dowel',
  mode: 'edit',
  result: null,
  sel: -1,
  plateView: false,
};

/* ---------------------------------------------------------- 3D setup */
const canvas = $('c3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 1, 100000);
camera.up.set(0, 0, 1);
camera.position.set(500, -700, 450);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.screenSpacePanning = true;
scene.add(new THREE.HemisphereLight(0xeef2ff, 0x30333a, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.6, -0.9, 1.4); scene.add(sun);
const sun2 = new THREE.DirectionalLight(0xffffff, 0.5); sun2.position.set(-1, 0.6, 0.3); scene.add(sun2);
camera.add(new THREE.PointLight(0xffffff, 0.25)); scene.add(camera);

const plateGroup = new THREE.Group(); scene.add(plateGroup);
const modelGroup = new THREE.Group(); scene.add(modelGroup);
const cutGroup = new THREE.Group(); scene.add(cutGroup);
const partsGroup = new THREE.Group(); scene.add(partsGroup);
let modelMesh = null;
let wire = false;
let showPlate = true;

const modelMat = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.55, metalness: 0.05, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

function buildPlate() {
  plateGroup.clear();
  const p = S.printer; if (!p) return;
  const g = [];
  const x0 = -p.x / 2, y0 = -p.y / 2;
  for (let x = 0; x <= p.x + 0.01; x += 10) g.push(x0 + x, y0, 0, x0 + x, y0 + p.y, 0);
  for (let y = 0; y <= p.y + 0.01; y += 10) g.push(x0, y0 + y, 0, x0 + p.x, y0 + y, 0);
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(g, 3)), new THREE.LineBasicMaterial({ color: 0x3a3d45, transparent: true, opacity: 0.7 }));
  plateGroup.add(grid);
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(p.x, p.y), new THREE.MeshBasicMaterial({ color: 0x1d1f24, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  bed.position.z = -0.2; plateGroup.add(bed);
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(p.x, p.y, p.z)), new THREE.LineBasicMaterial({ color: 0xffb03b, transparent: true, opacity: 0.45 }));
  box.position.set(0, 0, p.z / 2); plateGroup.add(box);
  plateGroup.visible = showPlate;
}

function frame(box, dir) {
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3()).length() || 300;
  const d = dir || camera.position.clone().sub(controls.target).normalize();
  const dist = s / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.05;
  controls.target.copy(c);
  camera.position.copy(c).add(d.multiplyScalar(dist));
  camera.near = dist / 100; camera.far = dist * 100; camera.updateProjectionMatrix();
}
function sceneBox() {
  const b = new THREE.Box3();
  if (S.mode === 'preview') b.setFromObject(partsGroup);
  else if (modelMesh) b.setFromObject(modelGroup);
  if (S.printer && (b.isEmpty() || showPlate)) b.union(new THREE.Box3(new THREE.Vector3(-S.printer.x / 2, -S.printer.y / 2, 0), new THREE.Vector3(S.printer.x / 2, S.printer.y / 2, S.printer.z * 0.6)));
  return b;
}
const VIEWS = { iso: [0.65, -0.95, 0.7], front: [0, -1, 0.0001], right: [1, 0, 0.0001], top: [0, -0.0001, 1] };
document.querySelectorAll('.vtools [data-view]').forEach((b) => b.onclick = () => frame(sceneBox(), new THREE.Vector3(...VIEWS[b.dataset.view]).normalize()));
$('tWire').onclick = () => { wire = !wire; $('tWire').classList.toggle('on', wire); modelMat.wireframe = wire; partsGroup.children.forEach((m) => m.material.wireframe = wire); };
$('tPlate').onclick = () => { showPlate = !showPlate; $('tPlate').classList.toggle('on', showPlate); plateGroup.visible = showPlate; };

/* ----------------------------------------------------------- UI helpers */
let toastT = 0;
function toast(msg, kind = 'err', ms = 5000) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast ' + (kind === 'info' ? 'info' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms);
}
function busy(text, frac) {
  if (text === false) { $('busy').classList.add('hidden'); return; }
  $('busy').classList.remove('hidden'); $('busyText').textContent = text;
  $('busyBar').style.width = (frac == null ? 0 : Math.round(frac * 100)) + '%';
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/* --------------------------------------------------------------- workers */
const geo = new Worker(new URL('./geo-worker.js', location.href), { type: 'module' });
let rpcId = 0; const pending = new Map();
geo.onmessage = (e) => {
  const { id, progress } = e.data; const p = pending.get(id); if (!p) return;
  if (progress) { p.onProgress && p.onProgress(progress); return; }
  pending.delete(id); e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
};
geo.onerror = (e) => console.error('geo worker', e);
function rpc(type, payload, onProgress) {
  return new Promise((resolve, reject) => { const id = ++rpcId; pending.set(id, { resolve, reject, onProgress }); geo.postMessage({ id, type, payload }); });
}
let stepWorker = null;
function readCAD(ext, buffer) {
  if (!stepWorker) stepWorker = new Worker(new URL('./step-worker.js', location.href));
  return new Promise((resolve, reject) => {
    stepWorker.onmessage = (e) => (e.data.ok ? resolve(e.data.meshes) : reject(new Error(e.data.error)));
    stepWorker.postMessage({ id: 1, ext, buffer }, [buffer]);
  });
}

/* ------------------------------------------------------------- loading */
function meshesFromObject(obj) {
  obj.updateMatrixWorld(true);
  const out = [];
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g.applyMatrix4(o.matrixWorld);
    out.push({ positions: new Float32Array(g.attributes.position.array), index: g.index ? new Uint32Array(g.index.array) : null });
  });
  return out;
}
async function parseModel(f) {
  const ext = f.ext; const buf = f.data;
  const text = () => new TextDecoder().decode(buf);
  switch (ext) {
    case 'stl': { const g = new STLLoader().parse(buf); return [{ positions: new Float32Array(g.attributes.position.array), index: null }]; }
    case 'ply': { const g = new PLYLoader().parse(buf); return [{ positions: new Float32Array(g.attributes.position.array), index: g.index ? new Uint32Array(g.index.array) : null }]; }
    case 'obj': return meshesFromObject(new OBJLoader().parse(text()));
    case '3mf': return meshesFromObject(new ThreeMFLoader().parse(buf));
    case 'amf': return meshesFromObject(new AMFLoader().parse(buf));
    case 'fbx': return meshesFromObject(new FBXLoader().parse(buf, ''));
    case 'wrl': return meshesFromObject(new VRMLLoader().parse(text(), ''));
    case 'glb': case 'gltf': { const g = await new GLTFLoader().parseAsync(buf, ''); return meshesFromObject(g.scene); }
    case 'step': case 'stp': case 'iges': case 'igs': case 'brep': return readCAD(ext, buf.slice(0));
    default: throw new Error('Unsupported file type: .' + ext);
  }
}

async function openFile(f) {
  if (!f) return;
  try {
    if (S.mode === 'preview') exitPreview();
    busy(`Reading ${f.name}…`, 0.1); await nextFrame();
    const meshes = (await parseModel(f)).filter((m) => m.positions.length >= 9);
    if (!meshes.length) throw new Error('No triangles found in this file.');
    busy('Building preview…', 0.4); await nextFrame();
    // display geometry: one non-indexed buffer
    let n = 0; for (const m of meshes) n += m.index ? m.index.length * 3 : m.positions.length;
    const pos = new Float32Array(n); let o = 0;
    for (const m of meshes) {
      if (m.index) for (let i = 0; i < m.index.length; i++) { const v = m.index[i] * 3; pos[o++] = m.positions[v]; pos[o++] = m.positions[v + 1]; pos[o++] = m.positions[v + 2]; }
      else { pos.set(m.positions, o); o += m.positions.length; }
    }
    const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (modelMesh) { modelGroup.remove(modelMesh); modelMesh.geometry.dispose(); }
    modelMesh = new THREE.Mesh(geom, modelMat); modelMesh.matrixAutoUpdate = false; modelGroup.add(modelMesh);
    S.model = { name: f.name, meshes, geom, watertight: null, triCount: n / 9 };
    S.rot.identity(); S.mir = [1, 1, 1]; S.sv = [1, 1, 1];
    // unit guess for glTF (metres)
    let unit = 1;
    if (ext(f) === 'glb' || ext(f) === 'gltf') { geom.computeBoundingBox(); const s = geom.boundingBox.getSize(new THREE.Vector3()); if (Math.max(s.x, s.y, s.z) < 5) unit = 1000; }
    S.units = unit; $('units').value = String(unit);
    $('baseName').value = f.name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_');
    $('fileInfo').innerHTML = `<b>${escapeHtml(f.name)}</b> · ${(n / 9).toLocaleString()} triangles`;
    $('dropHint').classList.add('hidden');
    recomputeRotBox();
    updateTransform(true);
    frame(sceneBox(), new THREE.Vector3(...VIEWS.iso).normalize());
    renderModelStats();
    busy('Checking mesh (watertight / manifold)…', 0.7); await nextFrame();
    const info = await rpc('load', { meshes });
    S.model.watertight = info.watertight; S.model.volume0 = info.volume; S.model.objects = info.objects;
    renderModelStats();
    if (!info.watertight) toast('This mesh is not watertight. ModCut can still slice it, but cut faces will be open and connectors are disabled. Repairing the model first (e.g. in your slicer) gives solid parts.', 'err', 10000);
    $('btnPreview').disabled = false;
  } catch (e) {
    console.error(e); toast('Could not open file: ' + e.message);
  } finally { busy(false); }
}
const ext = (f) => f.ext;
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

$('btnOpen').onclick = async () => openFile(await window.native.openModel());
window.native.onOpenPath(async (p) => openFile(await window.native.readPath(p)));
window.addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openFile(await window.native.openModel()); }
  if (e.key === 'Escape' && S.mode === 'preview' && S.view !== 'explode') setView('explode');
});
// drag & drop
const vp = $('viewport');
['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); vp.classList.add('dragging'); $('dropHint').classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) { vp.classList.remove('dragging'); $('dropHint').classList.remove('over'); } }));
document.addEventListener('drop', async (e) => {
  const file = e.dataTransfer.files[0]; if (!file) return;
  const p = window.native.pathForFile(file);
  if (p) openFile(await window.native.readPath(p));
  else openFile({ name: file.name, ext: file.name.split('.').pop().toLowerCase(), data: await file.arrayBuffer() });
});

/* ----------------------------------------------------------- transform */
function linearMatrix() {
  const s = S.sv.map((v) => v * S.units);
  const Smat = new THREE.Matrix4().makeScale(s[0], s[1], s[2]);
  const Mir = new THREE.Matrix4().makeScale(...S.mir);
  return Smat.multiply(Mir).multiply(S.rot);
}
function recomputeRotBox() {
  // bbox of Mir*Rot*p (unit scale) — recomputed only when rotation/mirror changes
  const A = new THREE.Matrix4().makeScale(...S.mir).multiply(S.rot).elements;
  const p = S.model.geom.attributes.position.array;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    for (let a = 0; a < 3; a++) { const v = A[a] * x + A[4 + a] * y + A[8 + a] * z; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  }
  S.model.rb = { min: mn, max: mx };
}
function updateTransform(resetCuts) {
  if (!S.model) return;
  const s = S.sv.map((v) => v * S.units);
  const rb = S.model.rb;
  const mn = rb.min.map((v, a) => v * s[a]), mx = rb.max.map((v, a) => v * s[a]);
  S.size = mx.map((v, a) => v - mn[a]);
  const T = new THREE.Matrix4().makeTranslation(-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]);
  S.M = T.multiply(linearMatrix());
  S.bounds = { min: [-S.size[0] / 2, -S.size[1] / 2, 0], max: [S.size[0] / 2, S.size[1] / 2, S.size[2]] };
  modelMesh.matrix.copy(S.M); modelMesh.matrixWorldNeedsUpdate = true;
  // size fields
  ['sizeX', 'sizeY', 'sizeZ'].forEach((id, a) => { if (document.activeElement !== $(id)) $(id).value = S.size[a].toFixed(1); });
  if (document.activeElement !== $('scalePct')) $('scalePct').value = +(S.sv[0] * 100).toFixed(2);
  if (S.layout === 'auto') autoLayout(); else if (resetCuts) evenCuts(); else clampCuts();
  renderModelStats();
  refreshLayout();
}

$('units').onchange = () => { S.units = +$('units').value; updateTransform(true); };
$('scalePct').onchange = () => {
  const v = +$('scalePct').value; if (!(v > 0)) return;
  const f = v / 100 / S.sv[0];
  S.sv = S.lock ? [v / 100, v / 100, v / 100] : S.sv.map((x) => x * f);
  updateTransform(true);
};
document.querySelectorAll('#scalePresets button').forEach((b) => b.onclick = () => { $('scalePct').value = b.dataset.s; $('scalePct').onchange(); });
['sizeX', 'sizeY', 'sizeZ'].forEach((id, a) => {
  $(id).onchange = () => {
    const v = +$(id).value; if (!(v > 0) || !S.model) return;
    const f = v / S.size[a];
    if (S.lock) S.sv = S.sv.map((x) => x * f); else S.sv[a] *= f;
    updateTransform(true);
  };
});
$('lockRatio').onclick = () => {
  S.lock = !S.lock; $('lockRatio').classList.toggle('on', S.lock);
  if (S.lock && S.model) { S.sv = [S.sv[0], S.sv[0], S.sv[0]]; updateTransform(true); }
};
document.querySelectorAll('#rotBtns [data-r]').forEach((b) => b.onclick = () => {
  if (!S.model) return;
  const R = new THREE.Matrix4();
  if (b.dataset.r === 'x') R.makeRotationX(Math.PI / 2); else if (b.dataset.r === 'y') R.makeRotationY(Math.PI / 2); else R.makeRotationZ(Math.PI / 2);
  // snap tiny float noise
  S.rot.premultiply(R); S.rot.elements.forEach((v, i) => { S.rot.elements[i] = Math.round(v); });
  if (!S.lock) { const a = b.dataset.r === 'x' ? [0, 2, 1] : b.dataset.r === 'y' ? [2, 1, 0] : [1, 0, 2]; S.sv = a.map((i) => S.sv[i]); }
  recomputeRotBox(); updateTransform(true);
});
$('rotReset').onclick = () => { if (!S.model) return; S.rot.identity(); S.mir = [1, 1, 1]; recomputeRotBox(); updateTransform(true); };
document.querySelectorAll('#mirBtns [data-m]').forEach((b) => b.onclick = () => {
  if (!S.model) return; S.mir[+b.dataset.m] *= -1; b.classList.toggle('on', S.mir[+b.dataset.m] < 0);
  recomputeRotBox(); updateTransform(true);
});

function renderModelStats() {
  const m = S.model; if (!m) return;
  const wt = m.watertight == null ? '<span class="tag warn">checking…</span>' : m.watertight ? '<span class="tag ok">watertight</span>' : '<span class="tag bad">open mesh</span>';
  const scl = S.sv[0] * S.units;
  const vol = m.volume0 ? m.volume0 * Math.abs(S.sv[0] * S.sv[1] * S.sv[2]) * S.units ** 3 : NaN;
  $('modelStats').innerHTML = `
    <div class="kv"><span>Mesh</span><span>${wt}</span></div>
    <div class="kv"><span>Triangles</span><span>${m.triCount.toLocaleString()}${m.objects > 1 ? ` · ${m.objects} objects` : ''}</span></div>
    <div class="kv"><span>Size (mm)</span><span>${S.size.map((v) => fmt(v)).join(' × ')}</span></div>
    <div class="kv"><span>Volume</span><span>${Number.isFinite(vol) ? fmt(vol / 1000, 1) + ' cm³' : '—'}</span></div>`;
}

/* --------------------------------------------------------------- layout */
function plateLimits() {
  const p = S.printer; const m = Math.max(0, +$('margin').value || 0);
  return [p.x, p.y, p.z].map((v) => Math.max(v - m, 1));
}
function fitsBox(d, P, allowRot) {
  if (!allowRot) return d[0] <= P[0] + 1e-6 && d[1] <= P[1] + 1e-6 && d[2] <= P[2] + 1e-6;
  const a = [...d].sort((x, y) => x - y), b = [...P].sort((x, y) => x - y);
  return a.every((v, i) => v <= b[i] + 1e-6);
}
function autoLayout() {
  if (!S.model || !S.printer) return;
  const P = plateLimits(), size = S.size;
  const rot = $('allowRotate').checked, allowZ = $('allowZ').checked;
  let best = null;
  if (!rot) {
    best = size.map((s, a) => Math.max(1, Math.ceil(s / P[a] - 1e-9)));
    if (!allowZ) best[2] = 1;
  } else {
    const minP = Math.min(...P);
    const lim = size.map((s) => Math.min(40, Math.ceil(s / minP) + 1));
    let bestScore = Infinity;
    for (let i = 1; i <= lim[0]; i++) for (let j = 1; j <= lim[1]; j++) for (let k = 1; k <= (allowZ ? lim[2] : 1); k++) {
      const n = i * j * k; if (n > bestScore / 1000 + 1) continue;
      if (!fitsBox([size[0] / i, size[1] / j, size[2] / k], P, true)) continue;
      const score = n * 1000 + (k - 1) * 10 + Math.abs(i - j);
      if (score < bestScore) { bestScore = score; best = [i, j, k]; }
    }
    if (!best) { // nothing fits (e.g. Z cuts disabled & too tall) — best effort
      best = size.map((s) => Math.max(1, Math.ceil(s / Math.max(...P))));
      if (!allowZ) best[2] = 1;
    }
  }
  S.counts = best;
  evenCuts();
}
function evenCuts() {
  S.cuts = [0, 1, 2].map((a) => {
    const n = S.counts[a]; const out = [];
    for (let k = 1; k < n; k++) out.push(S.bounds.min[a] + (S.size[a] * k) / n);
    return out;
  });
}
function clampCuts() {
  for (let a = 0; a < 3; a++) {
    S.cuts[a] = S.cuts[a].map((v) => Math.min(Math.max(v, S.bounds.min[a] + 0.5), S.bounds.max[a] - 0.5)).sort((x, y) => x - y);
  }
}
function cellBoxes() {
  const e = [0, 1, 2].map((a) => [S.bounds.min[a], ...S.cuts[a], S.bounds.max[a]]);
  const cells = [];
  for (let i = 0; i < e[0].length - 1; i++) for (let j = 0; j < e[1].length - 1; j++) for (let k = 0; k < e[2].length - 1; k++) {
    cells.push({ idx: [i, j, k], min: [e[0][i], e[1][j], e[2][k]], max: [e[0][i + 1], e[1][j + 1], e[2][k + 1]] });
  }
  return cells;
}

document.querySelectorAll('#layoutMode button').forEach((b) => b.onclick = () => setLayoutMode(b.dataset.mode));
function setLayoutMode(m) {
  S.layout = m;
  document.querySelectorAll('#layoutMode button').forEach((x) => x.classList.toggle('on', x.dataset.mode === m));
  if (m === 'auto') { autoLayout(); refreshLayout(); }
}
document.querySelectorAll('.countgrid .step').forEach((b) => b.onclick = () => {
  if (!S.model) return;
  const a = +b.dataset.ax; S.counts[a] = Math.max(1, Math.min(60, S.counts[a] + +b.dataset.d));
  setLayoutMode('manual'); evenCuts(); refreshLayout();
});
$('btnEven').onclick = () => { evenCuts(); refreshLayout(); };
['margin', 'allowRotate', 'allowZ'].forEach((id) => $(id).addEventListener('change', () => { if (S.layout === 'auto') autoLayout(); refreshLayout(); }));

function refreshLayout() {
  ['cntX', 'cntY', 'cntZ'].forEach((id, a) => $(id).textContent = S.cuts[a].length + 1);
  S.counts = S.cuts.map((c) => c.length + 1);
  buildCutList();
  buildCutVisuals();
  renderSummary();
}
function buildCutList() {
  const el = $('cutList'); el.innerHTML = '';
  if (!S.model) return;
  S.cuts.forEach((arr, a) => arr.forEach((v, i) => {
    const row = document.createElement('div'); row.className = 'cutrow';
    row.innerHTML = `<span class="ax ${'xyz'[a]}">${AXES[a]}</span><input type="range" min="${S.bounds.min[a]}" max="${S.bounds.max[a]}" step="0.1" value="${v}"><input type="number" step="0.1" value="${v.toFixed(1)}">`;
    const [rng, num] = row.querySelectorAll('input');
    const set = (val) => { setCut(a, i, +val); num.value = S.cuts[a][i].toFixed(1); rng.value = S.cuts[a][i]; };
    rng.oninput = () => set(rng.value); num.onchange = () => set(num.value);
    row.dataset.key = a + ':' + i;
    el.appendChild(row);
  }));
}
function setCut(a, i, v) {
  const lo = (i > 0 ? S.cuts[a][i - 1] : S.bounds.min[a]) + 1;
  const hi = (i < S.cuts[a].length - 1 ? S.cuts[a][i + 1] : S.bounds.max[a]) - 1;
  S.cuts[a][i] = Math.min(Math.max(v, lo), hi);
  if (S.layout !== 'manual') { S.layout = 'manual'; document.querySelectorAll('#layoutMode button').forEach((x) => x.classList.toggle('on', x.dataset.mode === 'manual')); }
  buildCutVisuals(); renderSummary();
  const row = document.querySelector(`.cutrow[data-key="${a}:${i}"]`);
  if (row) { const [rng, num] = row.querySelectorAll('input'); rng.value = S.cuts[a][i]; if (document.activeElement !== num) num.value = S.cuts[a][i].toFixed(1); }
}

let planeMeshes = [];
function buildCutVisuals() {
  cutGroup.clear(); planeMeshes = [];
  if (!S.model || S.mode !== 'edit') return;
  const b = S.bounds, size = S.size;
  const pad = Math.max(...size) * 0.06 + 4;
  for (let a = 0; a < 3; a++) S.cuts[a].forEach((v, i) => {
    const b1 = (a + 1) % 3, b2 = (a + 2) % 3;
    const w = size[b1] + 2 * pad, h = size[b2] + 2 * pad;
    const g = new THREE.PlaneGeometry(w, h);
    // PlaneGeometry lies in XY with normal Z; orient so normal = axis a
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: AXCOL[a], transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: AXCOL[a], transparent: true, opacity: 0.9 }));
    const holder = new THREE.Group(); holder.add(m, edge);
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]; c[a] = v;
    holder.position.set(...c);
    // PlaneGeometry: local x/y span the plane, local z is the normal
    if (a === 1) { holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0))); }
    if (a === 0) { holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))); }
    m.userData = { axis: a, index: i };
    cutGroup.add(holder); planeMeshes.push(m);
  });
  // highlight cells that won't fit
  if (!S.printer) return;
  const P = plateLimits(), rot = $('allowRotate').checked;
  for (const c of cellBoxes()) {
    const d = c.max.map((v, a) => v - c.min[a]);
    if (fitsBox(d, P, rot)) continue;
    const bx = new THREE.Mesh(new THREE.BoxGeometry(...d), new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.1, depthWrite: false }));
    const ed = new THREE.LineSegments(new THREE.EdgesGeometry(bx.geometry), new THREE.LineBasicMaterial({ color: 0xff5d5d }));
    const g = new THREE.Group(); g.add(bx, ed); g.position.set(...c.min.map((v, a) => v + d[a] / 2));
    cutGroup.add(g);
  }
}
function renderSummary() {
  if (!S.model || !S.printer) { $('layoutSummary').innerHTML = ''; return; }
  const cells = cellBoxes(); const P = plateLimits();
  const rot = $('allowRotate').checked;
  let bad = 0, rotated = 0; let big = [0, 0, 0];
  for (const c of cells) {
    const d = c.max.map((v, a) => v - c.min[a]);
    if (d[0] * d[1] * d[2] > big[0] * big[1] * big[2]) big = d;
    if (fitsBox(d, P, false)) continue;
    if (rot && fitsBox(d, P, true)) rotated++; else bad++;
  }
  const zHint = bad && !$('allowZ').checked ? ' — try allowing Z cuts' : bad && !rot ? ' — try allowing rotation' : '';
  const status = bad ? `<span class="bad">✖ ${bad} section${bad > 1 ? 's' : ''} larger than the plate${zHint}</span>` : rotated ? `<span class="warn">↻ fits — ${rotated} part${rotated > 1 ? 's' : ''} need rotating</span>` : '<span class="ok">✔ every section fits the plate</span>';
  $('layoutSummary').innerHTML = `<b>${cells.length}</b> section${cells.length > 1 ? 's' : ''} (${S.counts.join(' × ')}) · largest ${big.map((v) => fmt(v, 0)).join('×')} mm<br>${status}<br><span class="muted">Usable plate: ${P.map((v) => fmt(v, 0)).join(' × ')} mm</span>`;
}

/* ---------------------------------------------------- plane dragging */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null; let hoverPlane = null;
function setNdc(e) { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
canvas.addEventListener('pointerdown', (e) => {
  if (S.mode !== 'edit' || !planeMeshes.length || e.button !== 0) return;
  setNdc(e); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(planeMeshes, false)[0];
  if (!hit) return;
  const { axis, index } = hit.object.userData;
  const A = new THREE.Vector3(); A.setComponent(axis, 1);
  const Dc = camera.getWorldDirection(new THREE.Vector3());
  let N = Dc.clone().sub(A.clone().multiplyScalar(Dc.dot(A)));
  if (N.lengthSq() < 1e-6) N = new THREE.Vector3(axis === 2 ? 1 : 0, 0, axis === 2 ? 0 : 1);
  N.normalize();
  drag = { axis, index, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(N, hit.point), start: hit.point.getComponent(axis), v0: S.cuts[axis][index] };
  controls.enabled = false; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  setNdc(e); ray.setFromCamera(ndc, camera);
  if (drag) {
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(drag.plane, p)) setCut(drag.axis, drag.index, drag.v0 + p.getComponent(drag.axis) - drag.start);
    return;
  }
  if (S.mode !== 'edit') return;
  const hit = ray.intersectObjects(planeMeshes, false)[0];
  const h = hit ? hit.object : null;
  if (h !== hoverPlane) {
    if (hoverPlane) hoverPlane.material.opacity = 0.16;
    hoverPlane = h; if (h) h.material.opacity = 0.34;
    canvas.style.cursor = h ? 'grab' : '';
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (drag) { drag = null; controls.enabled = true; canvas.releasePointerCapture(e.pointerId); hoverPlane = null; buildCutVisuals(); }
});

/* ---------------------------------------------------------- connectors */
document.querySelectorAll('#connType button').forEach((b) => b.onclick = () => {
  S.conn = b.dataset.c; document.querySelectorAll('#connType button').forEach((x) => x.classList.toggle('on', x === b));
  updateConnHint();
});
function updateConnHint() {
  $('connOpts').style.display = S.conn === 'none' ? 'none' : '';
  $('connHint').textContent = S.conn === 'dowel'
    ? 'Matching holes on both sides of every cut. Print the exported dowel pins (or use wooden/metal dowels) and glue.'
    : 'A peg is added to one side and a socket (with clearance) to the other — parts self-align with nothing extra to print.';
}
updateConnHint();

/* --------------------------------------------------------- materials */
function fillMaterials() {
  const tech = S.printer ? S.printer.tech : 'fdm';
  const sel = $('material'); const cur = sel.value;
  sel.innerHTML = MATERIALS.filter((m) => m.tech === tech).map((m) => `<option value="${m.name}">${m.name} (${m.d} g/cm³)</option>`).join('');
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  $('infill').parentElement.parentElement.style.display = tech === 'resin' ? 'none' : '';
}
/* --------------------------------------------- orientation & print analysis */
const orientW = new Worker(new URL('./orient-worker.js', location.href), { type: 'module' });
let oId = 0; const oPending = new Map();
orientW.onmessage = (e) => {
  const { id, progress } = e.data; const p = oPending.get(id); if (!p) return;
  if (progress) { p.onProgress && p.onProgress(progress); return; }
  oPending.delete(id); e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
};
function orpc(type, payload, onProgress) {
  return new Promise((resolve, reject) => { const id = ++oId; oPending.set(id, { resolve, reject, onProgress }); orientW.postMessage({ id, type, payload }); });
}

const FIL = { pattern: 'rectilinear', supports: true, supportDensity: 15, angle: 45, walls: 2, lineWidth: 0.45, dia: 1.75 };
function filSettings() {
  return { infill: Math.max(0, Math.min(100, +$('infill').value || 0)), pattern: FIL.pattern, supports: FIL.supports, supportDensity: FIL.supportDensity, walls: FIL.walls, lineWidth: FIL.lineWidth, topBottom: 0.8, interfaceT: 0.4 };
}
function rotM4(R) { return new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1); }

async function analyzeParts() {
  const parts = S.result.parts;
  const res = await orpc('analyze', { parts: parts.map((p) => ({ vert: p.vert, tri: p.tri })), opts: { overhangAngle: FIL.angle } },
    (pr) => busy(`Auto-orienting parts (${Math.round(pr.frac * parts.length)}/${parts.length})…`, pr.frac));
  parts.forEach((p, i) => { p.analysis = res[i]; p.cols = null; p.orient = null; });
}

function chooseOrient(p) {
  const mode = $('orient').value; const P = [S.printer.x, S.printer.y, S.printer.z];
  const cands = [];
  for (const [i, a] of (p.analysis || []).entries()) {
    cands.push({ i, R: a.R, d: a.dims, sup: a.supportVol, contact: a.contact, z90: false });
    cands.push({ i, R: mul3(ROT_Z90, a.R), d: [a.dims[1], a.dims[0], a.dims[2]], sup: a.supportVol, contact: a.contact, z90: true });
  }
  if (!cands.length) { const d = p.bbox.max.map((v, a) => v - p.bbox.min[a]); cands.push({ i: 0, R: BASE_ROTS[0], d, sup: 0, contact: 0, z90: false }); }
  for (const c of cands) c.fits = fitsBox(c.d, P, false);
  const fitting = cands.filter((c) => c.fits);
  let o;
  if (mode === 'keep') o = cands[0];
  else if (!fitting.length) o = cands.slice().sort((a, b) => a.d[2] - b.d[2])[0];
  else if (mode === 'fit') o = fitting[0];
  else if (mode === 'flat') o = fitting.slice().sort((a, b) => a.d[2] - b.d[2] || a.sup - b.sup)[0];
  else {
    // least support material; then lower; prefer the modelled orientation on ties
    const score = (c) => c.sup * (FIL.supportDensity / 100) + c.contact * 0.28 + c.d[2] * 1.5 + (c.i === 0 ? 0 : 1) + (c.z90 ? 0.5 : 0);
    o = fitting.slice().sort((a, b) => score(a) - score(b))[0];
  }
  o.changed = !(o.i === 0 && !o.z90);
  return o;
}
// M = T · R  (R: chosen rotation, T: centre XY on origin and drop onto bed)
function placedMatrix(p) {
  const o = p.orient || (p.orient = chooseOrient(p));
  const R = rotM4(o.R);
  const b = p.bbox;
  const box = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)).applyMatrix4(R);
  const c = box.getCenter(new THREE.Vector3());
  const T = new THREE.Matrix4().makeTranslation(-c.x, -c.y, -box.min.z);
  return { M: T.clone().multiply(R), T, o };
}

/* ------------------------------------------------------------ preview */
$('btnPreview').onclick = runPreview;
async function runPreview() {
  if (!S.model || !S.printer) return;
  if (S.model.watertight == null) { toast('Still checking the mesh — try again in a moment.', 'info'); return; }
  const connector = S.model.watertight && S.conn !== 'none' ? {
    type: S.conn, diameter: +$('cDia').value, depth: +$('cDepth').value, tolerance: +$('cTol').value,
    wall: +$('cWall').value, maxPerFace: +$('cMax').value, segments: 40,
  } : { type: 'none' };
  busy('Cutting…', 0); await nextFrame();
  try {
    const res = await rpc('cut', {
      matrix: Array.from(S.M.elements), cuts: S.cuts.map((c) => c.slice()), bounds: S.bounds,
      connector, separateIslands: $('sepIslands').checked, minIslandVolume: 1,
    }, (pr) => busy(pr.stage + '…', pr.frac));
    if (!res.parts.length) throw new Error('The cut produced no parts.');
    S.result = res; S.result.connector = connector;
    busy('Auto-orienting parts…', 0); await nextFrame();
    await analyzeParts();
    enterPreview();
  } catch (e) { console.error(e); toast('Cut failed: ' + e.message); } finally { busy(false); }
}
const layoutGroup = new THREE.Group(); scene.add(layoutGroup);
const supMat = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.8, transparent: true, opacity: 0.38, depthWrite: false });
const supGeo = new THREE.BoxGeometry(1, 1, 1);
function enterPreview() {
  S.mode = 'preview'; S.sel = -1; S.plateView = false; S.view = 'explode';
  modelGroup.visible = false; cutGroup.clear(); planeMeshes = [];
  partsGroup.clear(); layoutGroup.clear();
  const parts = S.result.parts;
  parts.forEach((p, i) => {
    p.name = 'P' + String(i + 1).padStart(2, '0');
    p.cellName = p.cell.map((v, a) => AXES[a] + (v + 1)).join(' ') + (p.island ? ` #${p.island}` : '');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.vert, 3)); g.setIndex(new THREE.BufferAttribute(p.tri, 1));
    const col = new THREE.Color().setHSL((i * 0.61803) % 1, 0.55, 0.62);
    p.color = '#' + col.getHexString();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.05, flatShading: true, side: THREE.DoubleSide, wireframe: wire, transparent: true, opacity: 1 }));
    mesh.userData.part = i; p.mesh = mesh;
    partsGroup.add(mesh);
  });
  $('left').classList.add('locked'); $('btnPreview').disabled = true;
  $('previewBar').classList.remove('hidden'); $('right').classList.remove('hidden');
  resize(); renderParts(); setView('explode');
}
function exitPreview() {
  S.mode = 'edit'; S.plateView = false; S.view = 'explode';
  partsGroup.clear(); layoutGroup.clear(); modelGroup.visible = true;
  if (S.result) for (const p of S.result.parts) p.mesh && p.mesh.geometry.dispose();
  S.result = null;
  $('left').classList.remove('locked'); $('btnPreview').disabled = !S.model;
  $('previewBar').classList.add('hidden'); $('right').classList.add('hidden');
  resize(); buildPlate(); plateGroup.visible = showPlate; refreshLayout(); frame(sceneBox());
}
$('btnBack').onclick = exitPreview;
$('explode').oninput = applyExplode;
function applyExplode() {
  if (!S.result || S.view !== 'explode') return;
  const e = +$('explode').value / 100;
  const cellSize = S.size.map((s, a) => s / S.counts[a]);
  const gap = e * 0.55 * (cellSize.reduce((x, y) => x + y) / 3);
  for (const p of S.result.parts) {
    const off = p.cell.map((v, a) => (v - (S.counts[a] - 1) / 2) * gap * (a === 2 ? 1.2 : 1));
    p.mesh.matrixAutoUpdate = true; p.mesh.position.set(off[0], off[1], off[2] + (S.counts[2] > 1 ? gap * (S.counts[2] - 1) / 2 * 1.2 : 0));
    p.mesh.rotation.set(0, 0, 0); p.mesh.updateMatrix();
  }
}

/* ------------------------------------------------------------ view modes */
document.querySelectorAll('#viewMode button').forEach((b) => b.onclick = () => setView(b.dataset.v));
$('showSup').onchange = () => { if (S.view !== 'explode') setView(S.view, true); };
async function setView(v, keepCam) {
  if (!S.result) return;
  S.view = v; S.plateView = v !== 'explode';
  document.querySelectorAll('#viewMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('explodeWrap').classList.toggle('hidden', v !== 'explode');
  $('supWrap').classList.toggle('hidden', v === 'explode');
  layoutGroup.clear();
  const parts = S.result.parts;
  if (v === 'explode') {
    parts.forEach((p) => p.mesh.visible = true);
    plateGroup.visible = showPlate; applySel(); applyExplode(); if (!keepCam) frame(sceneBox());
    return;
  }
  if ($('showSup').checked) await ensureColumns();
  if (S.view !== v) return;
  if (v === 'single') { if (S.sel < 0) S.sel = 0; showOnPlate(keepCam); return; }
  if (!keepCam) S.sel = -1;
  showLayout(keepCam);
}
async function ensureColumns() {
  const parts = S.result.parts.filter((p) => !p.cols || p.colsKey !== orientKey(p));
  if (!parts.length) return;
  busy('Computing supports…', 0.3);
  try {
    const res = await orpc('columns', { parts: parts.map((p) => { placedMatrix(p); return { vert: p.vert, tri: p.tri, R: p.orient.R }; }), opts: { overhangAngle: FIL.angle } });
    parts.forEach((p, i) => { p.cols = res[i]; p.colsKey = orientKey(p); });
  } finally { busy(false); }
}
function orientKey(p) { const o = p.orient || (p.orient = chooseOrient(p)); return o.R.join(',') + '|' + FIL.angle; }
function supportMesh(p, placeT) {
  const c = p.cols && p.cols.columns; if (!c || !c.length || !$('showSup').checked) return null;
  const n = c.length / 4; const cell = p.cols.cell * 0.9;
  const im = new THREE.InstancedMesh(supGeo, supMat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const z0 = c[k * 4 + 2], z1 = c[k * 4 + 3];
    pv.set(c[k * 4], c[k * 4 + 1], (z0 + z1) / 2); sv.set(cell, cell, Math.max(z1 - z0, 0.05));
    im.setMatrixAt(k, m.compose(pv, q, sv));
  }
  im.matrixAutoUpdate = false; im.matrix.copy(placeT); im.matrixWorldNeedsUpdate = true;
  return im;
}
function showOnPlate(keepCam) {
  const i = S.sel < 0 ? 0 : S.sel;
  S.result.parts.forEach((p, j) => { p.mesh.visible = j === i; p.mesh.material.opacity = 1; p.mesh.material.depthWrite = true; });
  const p = S.result.parts[i];
  const { M, T } = placedMatrix(p);
  p.mesh.matrixAutoUpdate = false; p.mesh.matrix.copy(M); p.mesh.matrixWorldNeedsUpdate = true;
  layoutGroup.clear();
  const sm = supportMesh(p, T); if (sm) layoutGroup.add(sm);
  plateGroup.visible = true;
  if (!keepCam) frame(new THREE.Box3(new THREE.Vector3(-S.printer.x / 2, -S.printer.y / 2, 0), new THREE.Vector3(S.printer.x / 2, S.printer.y / 2, S.printer.z * 0.7)), new THREE.Vector3(...VIEWS.iso).normalize());
}

// Shelf packing of oriented footprints onto build plates.
function packPlates(parts) {
  const P = S.printer; const m = Math.max(0, +$('margin').value || 0); const gap = 5;
  const W = P.x - m, H = P.y - m;
  const items = parts.map((p, i) => ({ i, w: p.orient.d[0], h: p.orient.d[1] })).sort((a, b) => b.h - a.h || b.w - a.w);
  const plates = [];
  const tryPlace = (pl, it) => {
    for (const sh of pl.shelves) if (it.h <= sh.h + 1e-6 && sh.x + it.w <= W + 1e-6) { pl.items.push({ ...it, x: sh.x, y: sh.y }); sh.x += it.w + gap; return true; }
    if (pl.usedH + it.h <= H + 1e-6 && it.w <= W + 1e-6) { const sh = { y: pl.usedH, h: it.h, x: it.w + gap }; pl.shelves.push(sh); pl.usedH += it.h + gap; pl.items.push({ ...it, x: 0, y: sh.y }); return true; }
    return false;
  };
  for (const it of items) {
    if (plates.some((pl) => tryPlace(pl, it))) continue;
    const pl = { shelves: [], items: [], usedH: 0 }; plates.push(pl);
    if (!tryPlace(pl, it)) pl.items.push({ ...it, x: 0, y: 0, over: true });
  }
  // centre each plate's content
  for (const pl of plates) {
    const ux = Math.max(...pl.items.map((t) => t.x + t.w)), uy = Math.max(...pl.items.map((t) => t.y + t.h));
    pl.items.forEach((t) => { t.cx = t.x + t.w / 2 - ux / 2; t.cy = t.y + t.h / 2 - uy / 2; });
  }
  return plates;
}
function textSprite(text, size) {
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  ctx.font = '600 44px Segoe UI, system-ui, sans-serif';
  c.width = Math.ceil(ctx.measureText(text).width) + 24; c.height = 64;
  ctx.font = '600 44px Segoe UI, system-ui, sans-serif'; ctx.fillStyle = '#e7e8ea'; ctx.textBaseline = 'middle'; ctx.fillText(text, 12, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true }));
  sp.scale.set(size * c.width / c.height, size, 1); return sp;
}
function drawPlate(ox, oy, label) {
  const P = S.printer; const g = new THREE.Group(); g.position.set(ox, oy, 0);
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(P.x, P.y), new THREE.MeshBasicMaterial({ color: 0x1d1f24, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false }));
  bed.position.z = -0.2; g.add(bed);
  const pts = []; for (let x = 0; x <= P.x + 0.01; x += 20) pts.push(x - P.x / 2, -P.y / 2, 0, x - P.x / 2, P.y / 2, 0);
  for (let y = 0; y <= P.y + 0.01; y += 20) pts.push(-P.x / 2, y - P.y / 2, 0, P.x / 2, y - P.y / 2, 0);
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0x34373f })));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(P.x, P.y)), new THREE.LineBasicMaterial({ color: 0xffb03b })));
  const t = textSprite(label, Math.max(P.x, P.y) * 0.07); t.position.set(0, -P.y / 2 - Math.max(P.x, P.y) * 0.08, 0.5); g.add(t);
  layoutGroup.add(g);
}
function showLayout(keepCam) {
  const parts = S.result.parts; const P = S.printer;
  plateGroup.visible = false;
  parts.forEach((p) => placedMatrix(p));
  const plates = S.plates = packPlates(parts);
  const cols = Math.ceil(Math.sqrt(plates.length));
  const sx = P.x * 1.18 + 20, sy = P.y * 1.3 + 30;
  plates.forEach((pl, k) => {
    const ox = (k % cols) * sx, oy = -Math.floor(k / cols) * sy;
    drawPlate(ox, oy, `Plate ${k + 1} · ${pl.items.length} part${pl.items.length > 1 ? 's' : ''}`);
    for (const it of pl.items) {
      const p = parts[it.i]; const { M, T } = placedMatrix(p);
      const W = new THREE.Matrix4().makeTranslation(ox + it.cx, oy + it.cy, 0);
      p.mesh.matrixAutoUpdate = false; p.mesh.matrix.copy(W.clone().multiply(M)); p.mesh.matrixWorldNeedsUpdate = true; p.mesh.visible = true;
      const sm = supportMesh(p, W.clone().multiply(T)); if (sm) layoutGroup.add(sm);
    }
  });
  applySel();
  renderPartsTotals();
  if (!keepCam) { const b = new THREE.Box3().setFromObject(layoutGroup); b.union(new THREE.Box3().setFromObject(partsGroup)); frame(b, new THREE.Vector3(0.35, -0.75, 1).normalize()); }
}

/* ------------------------------------------------------------ parts list */
function estimate(p) {
  if (!Number.isFinite(p.volume)) return { g: NaN, cost: NaN, supG: NaN, m: NaN };
  const mat = MATERIALS.find((m) => m.name === $('material').value) || MATERIALS[0];
  const price = +$('price').value || 0;
  if (S.printer.tech === 'resin') { const g = (p.volume / 1000) * mat.d; return { g, cost: (g / 1000) * price, supG: 0, m: NaN }; }
  const o = p.orient || (p.orient = chooseOrient(p));
  const f = filamentFor(p, { supportVol: o.sup, contact: o.contact }, filSettings());
  const g = (f.total / 1000) * mat.d, supG = (f.support / 1000) * mat.d;
  const r = FIL.dia / 2;
  return { g, supG, modelG: g - supG, cost: (g / 1000) * price, m: f.total / (Math.PI * r * r) / 1000 };
}
function renderParts() {
  const parts = S.result.parts;
  $('partCount').textContent = parts.length;
  const rows = parts.map((p, i) => {
    const o = p.orient = chooseOrient(p);
    const est = estimate(p);
    const tag = !o.fits ? '<span class="tag bad">too big</span>' : o.changed ? '<span class="tag warn">re-oriented</span>' : '<span class="tag ok">fits</span>';
    const supTxt = S.printer.tech !== 'resin' && Number.isFinite(est.supG) ? (est.supG < 0.5 ? ' · no supports' : ` · ${fmt(est.supG, 0)} g supports`) : '';
    return `<div class="part${S.sel === i ? ' sel' : ''}" data-i="${i}"><span class="sw" style="background:${p.color}"></span><span class="nm">${p.name} <span class="muted" style="font-weight:400">${p.cellName}</span></span>${tag}
      <div class="meta">${o.d.map((v) => fmt(v)).join(' × ')} mm${Number.isFinite(p.volume) ? ` · ~${fmt(est.g, 0)} g${supTxt} · ${fmt(est.cost, 2)} ${$('cur').textContent}` : ''}</div></div>`;
  });
  $('partList').innerHTML = rows.join('');
  $('partList').querySelectorAll('.part').forEach((el) => el.onclick = () => selectPart(+el.dataset.i));
  renderPartsTotals();
  $('warnings').innerHTML = (S.result.warnings || []).map((w) => `<div class="warnbox">${escapeHtml(w)}</div>`).join('');
}
function renderPartsTotals() {
  const parts = S.result.parts;
  let tg = 0, tc = 0, ts = 0, bad = 0, rot = 0;
  for (const p of parts) { const e = estimate(p); tg += e.g || 0; tc += e.cost || 0; ts += e.supG || 0; if (!p.orient.fits) bad++; else if (p.orient.changed) rot++; }
  const conns = S.result.connectors.length;
  const solid = parts.every((p) => Number.isFinite(p.volume));
  const plates = packPlates(parts).length;
  const fdm = S.printer.tech !== 'resin';
  $('partTotals').innerHTML = `${solid ? `Total: ~<b>${fmt(tg / 1000, 2)} kg</b>${fdm ? ` (${fmt(ts / 1000, 2)} kg supports)` : ''} · <b>${fmt(tc, 2)} ${$('cur').textContent}</b>` : 'Weight unavailable (open mesh)'}<br>
    ${fdm ? `${$('infill').value}% ${FIL.pattern} infill${FIL.supports ? `, supports ${FIL.supportDensity}%` : ', no supports'} · ` : ''}<b>${plates}</b> print plate${plates > 1 ? 's' : ''}<br>
    ${conns ? `${conns} connector${conns > 1 ? 's' : ''} (${S.result.connector.type === 'dowel' ? `${conns} dowel pins Ø${S.result.connector.diameter} mm` : 'peg + socket'})<br>` : ''}
    ${bad ? `<span style="color:var(--bad)">${bad} part(s) still exceed the build volume</span>` : `<span style="color:var(--ok)">All parts fit the ${escapeHtml(S.printer.name)}</span>`}${rot ? ` · ${rot} auto-oriented` : ''}`;
}
function selectPart(i) {
  S.sel = S.sel === i ? -1 : i;
  if (S.view === 'single' && S.sel < 0) S.sel = i;
  applySel();
}
function applySel() {
  if (S.view === 'single') { $('partList').querySelectorAll('.part').forEach((el) => el.classList.toggle('sel', +el.dataset.i === S.sel)); showOnPlate(); return; }
  S.result.parts.forEach((p, j) => { p.mesh.material.opacity = S.sel < 0 || j === S.sel ? 1 : 0.12; p.mesh.material.depthWrite = S.sel < 0 || j === S.sel; });
  $('partList').querySelectorAll('.part').forEach((el) => el.classList.toggle('sel', +el.dataset.i === S.sel));
}
canvas.addEventListener('dblclick', (e) => {
  if (S.mode !== 'preview') return;
  setNdc(e); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(partsGroup.children.filter((m) => m.visible), false)[0];
  if (hit) { selectPart(hit.object.userData.part); const el = $('partList').querySelector(`[data-i="${hit.object.userData.part}"]`); el && el.scrollIntoView({ block: 'nearest' }); }
});
function refreshAfterSettings() {
  if (!S.result) return;
  renderParts();
  if (S.view !== 'explode') setView(S.view, true);
}
['material', 'infill', 'price', 'orient'].forEach((id) => $(id).addEventListener('change', () => { if (id === 'infill') $('fInfill').value = $('infill').value; refreshAfterSettings(); if (!$('filModal').classList.contains('hidden')) renderFil(); }));

/* ------------------------------------------------------ filament dialog */
$('btnFil').onclick = () => {
  $('fInfill').value = $('infill').value; $('fPattern').value = FIL.pattern; $('fSup').value = FIL.supports ? '1' : '0';
  $('fSupD').value = FIL.supportDensity; $('fAngle').value = FIL.angle; $('fWalls').value = FIL.walls; $('fLine').value = FIL.lineWidth; $('fDia').value = String(FIL.dia);
  $('filModal').classList.remove('hidden'); renderFil();
};
$('filClose').onclick = () => $('filModal').classList.add('hidden');
['fInfill', 'fPattern', 'fSup', 'fSupD', 'fAngle', 'fWalls', 'fLine', 'fDia'].forEach((id) => $(id).addEventListener('change', async () => {
  $('infill').value = Math.max(0, Math.min(100, +$('fInfill').value || 0));
  FIL.pattern = $('fPattern').value; FIL.supports = $('fSup').value === '1';
  FIL.supportDensity = Math.max(1, +$('fSupD').value || 15); FIL.walls = Math.max(1, Math.round(+$('fWalls').value || 2));
  FIL.lineWidth = Math.max(0.1, +$('fLine').value || 0.45); FIL.dia = +$('fDia').value;
  const ang = Math.max(10, Math.min(85, +$('fAngle').value || 45));
  if (ang !== FIL.angle) { FIL.angle = ang; busy('Re-analysing overhangs…', 0); try { await analyzeParts(); } finally { busy(false); } }
  refreshAfterSettings(); renderFil();
}));
function filRows() {
  const mat = MATERIALS.find((m) => m.name === $('material').value) || MATERIALS[0];
  const r = FIL.dia / 2, price = +$('price').value || 0;
  const rows = S.result.parts.map((p) => {
    const e = estimate(p);
    return { name: `${p.name} ${p.cellName}`, size: p.orient.d.map((v) => fmt(v, 0)).join('×'), model: e.modelG, sup: e.supG, g: e.g, m: e.m, cost: e.cost };
  });
  const c = S.result.connector;
  if (c.type === 'dowel' && S.result.connectors.length) {
    const n = S.result.connectors.length;
    const len = Math.max(2, 2 * c.depth - 2 * c.tolerance - 0.6);
    const vol = n * Math.PI * (c.diameter / 2) ** 2 * len * 0.85;
    const g = (vol / 1000) * mat.d;
    rows.push({ name: `Dowel pins ×${n}`, size: `Ø${c.diameter}×${fmt(len, 0)}`, model: g, sup: 0, g, m: vol / (Math.PI * r * r) / 1000, cost: (g / 1000) * price });
  }
  return rows;
}
function renderFil() {
  if (!S.result) return;
  const cur = $('cur').textContent; const mat = $('material').value;
  if (S.printer.tech === 'resin') $('filSub').innerHTML = `<span style="color:var(--warn)">Your printer is set to resin — this is an FDM estimate, as if the parts were printed on a filament printer.</span>`;
  else $('filSub').textContent = `${mat} · ${$('infill').value}% ${FIL.pattern} infill · ${FIL.walls} walls × ${FIL.lineWidth} mm · supports ${FIL.supports ? `${FIL.supportDensity}% where overhang > ${FIL.angle}°` : 'off'} · parts in their auto-oriented print position.`;
  const rows = filRows();
  if (rows.some((x) => !Number.isFinite(x.g))) { $('filResult').innerHTML = '<p style="padding:14px">Weight needs a watertight model — this mesh is open, so its volume is unknown.</p>'; return; }
  const T = rows.reduce((a, x) => ({ model: a.model + x.model, sup: a.sup + x.sup, g: a.g + x.g, m: a.m + x.m, cost: a.cost + x.cost }), { model: 0, sup: 0, g: 0, m: 0, cost: 0 });
  $('filResult').innerHTML = `<div class="fsum" style="padding:12px 12px 0">
      <div><span>Total filament</span><b>${fmt(T.g / 1000, 2)} kg</b><span>${fmt(T.g / 1000, 1)} × 1 kg spool</span></div>
      <div><span>Length (Ø${FIL.dia})</span><b>${fmt(T.m, 0)} m</b><span>${S.result.parts.length} parts</span></div>
      <div><span>Supports</span><b>${fmt(T.sup / 1000, 2)} kg</b><span>${fmt(T.g ? (100 * T.sup) / T.g : 0, 0)}% of total</span></div>
      <div><span>Material cost</span><b>${fmt(T.cost, 2)} ${cur}</b><span>at ${$('price').value} ${cur}/kg</span></div>
    </div>
    <table class="ftab"><tr><th>Part</th><th>Print size (mm)</th><th>Model g</th><th>Support g</th><th>Total g</th><th>Metres</th><th>${cur}</th></tr>
    ${rows.map((x) => `<tr><td>${escapeHtml(x.name)}</td><td>${x.size}</td><td>${fmt(x.model, 0)}</td><td>${fmt(x.sup, 0)}</td><td>${fmt(x.g, 0)}</td><td>${fmt(x.m, 1)}</td><td>${fmt(x.cost, 2)}</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td></td><td>${fmt(T.model, 0)}</td><td>${fmt(T.sup, 0)}</td><td>${fmt(T.g, 0)}</td><td>${fmt(T.m, 0)}</td><td>${fmt(T.cost, 2)}</td></tr></table>`;
  S.filTsv = ['Part\tSize mm\tModel g\tSupport g\tTotal g\tMetres\tCost', ...rows.map((x) => [x.name, x.size, fmt(x.model, 0), fmt(x.sup, 0), fmt(x.g, 0), fmt(x.m, 1), fmt(x.cost, 2)].join('\t')), ['Total', '', fmt(T.model, 0), fmt(T.sup, 0), fmt(T.g, 0), fmt(T.m, 0), fmt(T.cost, 2)].join('\t')].join('\n');
}
$('filCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(S.filTsv || ''); toast('Table copied — paste it into Excel or Sheets.', 'info', 2500); }
  catch (e) { toast('Could not copy: ' + e.message); }
};

/* ------------------------------------------------------------- export */
function stlMulti(list) {
  const bufs = list.map((x) => stlBinary(x.vert, x.tri, x.M));
  const n = bufs.reduce((a, b) => a + (b.byteLength - 84) / 50, 0);
  const out = new Uint8Array(84 + n * 50); out.set(new Uint8Array(bufs[0], 0, 80));
  new DataView(out.buffer).setUint32(80, n, true);
  let o = 84; for (const b of bufs) { out.set(new Uint8Array(b, 84), o); o += b.byteLength - 84; }
  return out.buffer;
}
function stlBinary(vert, tri, M) {
  const n = tri.length / 3;
  const buf = new ArrayBuffer(84 + n * 50); const dv = new DataView(buf);
  const head = 'ModCut binary STL'; for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  const e = M.elements; const det = M.determinant();
  const tv = (i) => { const x = vert[i * 3], y = vert[i * 3 + 1], z = vert[i * 3 + 2]; return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; };
  let o = 84;
  for (let t = 0; t < n; t++) {
    let a = tv(tri[t * 3]), b = tv(tri[t * 3 + 1]), c = tv(tri[t * 3 + 2]);
    if (det < 0) { const s = b; b = c; c = s; }
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
    for (const p of [a, b, c]) { dv.setFloat32(o, p[0], true); dv.setFloat32(o + 4, p[1], true); dv.setFloat32(o + 8, p[2], true); o += 12; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return buf;
}
function dowelPin(d, len) {
  const r = d / 2, ch = Math.min(0.6, r * 0.3);
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r - ch, 0), new THREE.Vector2(r, ch), new THREE.Vector2(r, len - ch), new THREE.Vector2(r - ch, len), new THREE.Vector2(0, len)];
  const g = new THREE.LatheGeometry(pts, 48).rotateX(Math.PI / 2); // axis -> Z
  const merged = g.toNonIndexed();
  const v = new Float32Array(merged.attributes.position.array);
  const tri = new Uint32Array(v.length / 3).map((_, i) => i);
  g.dispose(); merged.dispose();
  return stlBinary(v, tri, new THREE.Matrix4());
}
$('btnExport').onclick = async () => {
  if (!S.result) return;
  const folder = await window.native.chooseFolder(store.get('lastFolder', null));
  if (!folder) return;
  store.set('lastFolder', folder);
  busy('Writing files…', 0.2); await nextFrame();
  try {
    const base = ($('baseName').value || 'model').replace(/[^\w\-]+/g, '_');
    const files = [];
    const parts = S.result.parts;
    parts.forEach((p) => {
      const { M } = placedMatrix(p);
      const tag = p.cell.map((v, a) => 'xyz'[a] + (v + 1)).join('') + (p.island ? '_' + p.island : '');
      p.file = `${base}_${p.name}_${tag}.stl`;
      files.push({ name: p.file, data: stlBinary(p.vert, p.tri, M) });
    });
    const c = S.result.connector;
    const pinFiles = [];
    if (c.type === 'dowel' && S.result.connectors.length) {
      const groups = new Map();
      for (const k of S.result.connectors) {
        const len = Math.max(2, Math.floor((2 * (k.depth || c.depth) - 2 * c.tolerance - 0.6) * 2) / 2);
        groups.set(len, (groups.get(len) || 0) + 1);
      }
      for (const [len, qty] of groups) {
        const nm = `${base}_dowel_D${c.diameter}x${len}mm_qty${qty}.stl`;
        files.push({ name: nm, data: dowelPin(c.diameter, len) }); pinFiles.push({ nm, qty, len });
      }
    }
    let plateCount = 0;
    if ($('expPlates').checked && parts.length > 1) {
      const plates = packPlates(parts);
      plates.forEach((pl, k) => {
        const list = pl.items.map((it) => { const p = parts[it.i]; const { M } = placedMatrix(p); return { vert: p.vert, tri: p.tri, M: new THREE.Matrix4().makeTranslation(it.cx, it.cy, 0).multiply(M) }; });
        files.push({ name: `${base}_plate${String(k + 1).padStart(2, '0')}.stl`, data: stlMulti(list) });
      });
      plateCount = plates.length;
    }
    files.push({ name: `${base}_assembly_report.html`, data: new TextEncoder().encode(reportHtml(base, pinFiles)) });
    const dir = await window.native.writeFiles(folder, `${base}_cut`, files);
    lastExportDir = dir;
    $('doneText').innerHTML = `${parts.length} part${parts.length > 1 ? 's' : ''}${pinFiles.length ? ` + ${pinFiles.reduce((a, p) => a + p.qty, 0)} dowel pins` : ''}${plateCount ? `, ${plateCount} packed print plate${plateCount > 1 ? 's' : ''}` : ''} and an assembly report were saved to:<br><b>${escapeHtml(dir)}</b>`;
    $('doneModal').classList.remove('hidden');
  } catch (e) { console.error(e); toast('Export failed: ' + e.message); } finally { busy(false); }
};
let lastExportDir = null;
$('doneOpen').onclick = () => { if (lastExportDir) window.native.showFolder(lastExportDir); };
$('doneClose').onclick = () => $('doneModal').classList.add('hidden');

function reportHtml(base, pins) {
  // snapshot of current exploded view
  if (S.view !== 'explode') setView('explode');
  renderer.render(scene, camera);
  const img = renderer.domElement.toDataURL('image/png');
  const c = S.result.connector; const cur = $('cur').textContent;
  const rows = S.result.parts.map((p) => {
    const est = estimate(p);
    return `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${p.color}"></span> ${p.name}</td><td>${p.cellName}</td><td>${p.orient.d.map((v) => fmt(v)).join(' × ')}</td><td>${fmt(p.volume / 1000)}</td><td>${fmt(est.g, 0)}</td><td>${fmt(est.supG, 0)}</td><td>${fmt(est.cost, 2)}</td><td>${p.orient.fits ? 'yes' : '<b style="color:#c22">NO</b>'}</td><td>${escapeHtml(p.file || '')}</td></tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(base)} – assembly</title>
<style>body{font:14px Segoe UI,system-ui,sans-serif;margin:32px;color:#222;max-width:1100px}h1{margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:16px}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;font-size:13px}th{background:#f4f4f4}.muted{color:#777}img{max-width:100%;border-radius:8px;background:#1a1b1e;margin-top:16px}</style></head><body>
<h1>${escapeHtml(base)} — cut plan</h1>
<div class="muted">ModCut · ${new Date().toLocaleString()} · printer: ${escapeHtml(S.printer.name)} (${S.printer.x}×${S.printer.y}×${S.printer.z} mm, ${S.printer.tech.toUpperCase()})</div>
<p>Model size: <b>${S.size.map((v) => fmt(v)).join(' × ')} mm</b> · grid ${S.counts.join(' × ')} · ${S.result.parts.length} parts · connectors: ${c.type === 'none' ? 'none' : c.type === 'dowel' ? `dowel holes Ø${c.diameter} mm (+${c.tolerance} clearance), ${S.result.connectors.length} pins` : `peg + socket Ø${c.diameter} mm, ${S.result.connectors.length} pairs`}.
Part names use the grid position: X1 Y1 Z1 is the front-left-bottom section; numbers grow toward +X (right), +Y (back) and +Z (up).</p>
${pins.length ? `<p>Dowel pins to print: ${pins.map((p) => `<b>${p.qty} × Ø${c.diameter}×${p.len} mm</b> (${escapeHtml(p.nm)})`).join(', ')}</p>` : ''}
<img src="${img}">
<table><tr><th>Part</th><th>Grid</th><th>Print size (mm)</th><th>cm³</th><th>~g total</th><th>g supports</th><th>${cur}</th><th>Fits</th><th>File</th></tr>${rows}</table>
<p class="muted">Weight/cost are estimates (${escapeHtml($('material').value)}${S.printer.tech !== 'resin' ? `, ${$('infill').value}% ${FIL.pattern} infill, ${FIL.walls} walls, supports ${FIL.supports ? FIL.supportDensity + '% at >' + FIL.angle + '° overhangs' : 'off'}; parts in auto-oriented print position` : ', solid'}). Print plates: ${packPlates(S.result.parts).length}.</p>
</body></html>`;
}

/* ------------------------------------------------------- printer modal */
function savedPrinters() { return store.get('printers', []); }
function openPrinterModal() {
  const sel = $('pPreset');
  const saved = savedPrinters();
  sel.innerHTML = `<option value="custom">Custom…</option>` +
    (saved.length ? `<optgroup label="My printers">${saved.map((p, i) => `<option value="s${i}">${escapeHtml(p.name)}</option>`).join('')}</optgroup>` : '') +
    `<optgroup label="Presets">${PRESETS.map((p, i) => `<option value="p${i}">${p.name} — ${p.x}×${p.y}×${p.z}</option>`).join('')}</optgroup>`;
  const cur = S.printer || PRESETS[0];
  fillPrinterForm(cur);
  const si = saved.findIndex((p) => p.name === cur.name), pi = PRESETS.findIndex((p) => p.name === cur.name);
  sel.value = si >= 0 ? 's' + si : pi >= 0 ? 'p' + pi : 'custom';
  $('pCancel').style.display = S.printer ? '' : 'none';
  $('pDelete').style.visibility = sel.value[0] === 's' ? 'visible' : 'hidden';
  $('printerModal').classList.remove('hidden');
}
function fillPrinterForm(p) {
  $('pName').value = p.name; $('pX').value = p.x; $('pY').value = p.y; $('pZ').value = p.z;
  document.querySelectorAll('#pTech button').forEach((b) => b.classList.toggle('on', b.dataset.t === p.tech));
}
$('pPreset').onchange = () => {
  const v = $('pPreset').value;
  if (v[0] === 'p') fillPrinterForm(PRESETS[+v.slice(1)]);
  else if (v[0] === 's') fillPrinterForm(savedPrinters()[+v.slice(1)]);
  else $('pName').value = 'My printer';
  $('pDelete').style.visibility = v[0] === 's' ? 'visible' : 'hidden';
};
document.querySelectorAll('#pTech button').forEach((b) => b.onclick = () => document.querySelectorAll('#pTech button').forEach((x) => x.classList.toggle('on', x === b)));
$('pCancel').onclick = () => $('printerModal').classList.add('hidden');
$('pDelete').onclick = () => {
  const v = $('pPreset').value; if (v[0] !== 's') return;
  const saved = savedPrinters(); saved.splice(+v.slice(1), 1); store.set('printers', saved); openPrinterModal();
};
$('pSave').onclick = () => {
  const p = { name: $('pName').value.trim() || 'My printer', x: +$('pX').value, y: +$('pY').value, z: +$('pZ').value, tech: document.querySelector('#pTech button.on').dataset.t };
  if (!(p.x > 0 && p.y > 0 && p.z > 0)) { toast('Enter the build volume in millimetres.'); return; }
  const isPreset = PRESETS.some((q) => q.name === p.name && q.x === p.x && q.y === p.y && q.z === p.z);
  if (!isPreset) { const saved = savedPrinters().filter((q) => q.name !== p.name); saved.unshift(p); store.set('printers', saved.slice(0, 20)); }
  setPrinter(p);
  $('printerModal').classList.add('hidden');
};
function setPrinter(p) {
  const techChanged = !S.printer || S.printer.tech !== p.tech;
  S.printer = p; store.set('printer', p);
  $('printerName').textContent = p.name; $('printerDims').textContent = `${p.x}×${p.y}×${p.z} mm`;
  if (techChanged) $('cTol').value = p.tech === 'resin' ? 0.15 : 0.2;
  fillMaterials(); buildPlate();
  if (S.model && S.mode === 'edit') { if (S.layout === 'auto') autoLayout(); refreshLayout(); frame(sceneBox()); }
  if (S.result) renderParts();
}
$('printerChip').onclick = openPrinterModal;

/* ------------------------------------------------------------- startup */
(async function init() {
  if (S.printer) setPrinter(S.printer); else { fillMaterials(); openPrinterModal(); }
  frame(sceneBox(), new THREE.Vector3(...VIEWS.iso).normalize());
  const f = await window.native.pendingFile();
  if (f) openFile(f);
})();
