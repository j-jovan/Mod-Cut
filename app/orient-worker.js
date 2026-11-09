import { analyzePart, analyzeOrientation } from './print-est.js';

self.onmessage = (e) => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'analyze') {
      const out = [];
      payload.parts.forEach((p, i) => {
        out.push(analyzePart(p.vert, p.tri, payload.opts));
        self.postMessage({ id, progress: { frac: (i + 1) / payload.parts.length } });
      });
      self.postMessage({ id, ok: true, result: out });
    } else if (type === 'columns') {
      const out = payload.parts.map((p) => {
        const r = analyzeOrientation(p.vert, p.tri, p.R, { ...payload.opts, columns: true, res: 90 });
        return { columns: r.columns, cell: r.cell };
      });
      self.postMessage({ id, ok: true, result: out }, out.map((c) => c.columns.buffer));
    }
  } catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
};
