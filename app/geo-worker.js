import Module from './vendor/manifold.js';
import * as core from './geo-core.js';

const ready = Module({ locateFile: (f) => new URL('./vendor/' + f, import.meta.url).href })
  .then((w) => { w.setup(); core.initCore(w); });

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    await ready;
    if (type === 'load') {
      const r = core.loadModel(payload.meshes);
      self.postMessage({ id, ok: true, result: r });
    } else if (type === 'cut') {
      const r = core.cutModel(payload, (stage, frac) => self.postMessage({ id, progress: { stage, frac } }));
      const transfer = [];
      for (const p of r.parts) transfer.push(p.vert.buffer, p.tri.buffer);
      self.postMessage({ id, ok: true, result: r }, transfer);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
