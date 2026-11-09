// Converts STEP / IGES / BREP to triangle meshes with OpenCascade (occt-import-js)
importScripts('./vendor/occt-import-js.js');
let occtP = null;
self.onmessage = async (e) => {
  const { id, ext, buffer, quality } = e.data;
  try {
    if (!occtP) occtP = occtimportjs({ locateFile: (f) => './vendor/' + f });
    const occt = await occtP;
    const data = new Uint8Array(buffer);
    const params = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: quality || 0.001, angularDeflection: 0.5 };
    let res;
    if (ext === 'igs' || ext === 'iges') res = occt.ReadIgesFile(data, params);
    else if (ext === 'brep') res = occt.ReadBrepFile(data, params);
    else res = occt.ReadStepFile(data, params);
    if (!res.success) throw new Error('Could not read CAD file');
    const meshes = res.meshes.map((m) => ({
      positions: new Float32Array(m.attributes.position.array),
      index: m.index ? new Uint32Array(m.index.array) : null,
    }));
    self.postMessage({ id, ok: true, meshes }, meshes.flatMap((m) => m.index ? [m.positions.buffer, m.index.buffer] : [m.positions.buffer]));
  } catch (err) { self.postMessage({ id, ok: false, error: String(err.message || err) }); }
};
