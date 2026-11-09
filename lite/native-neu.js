// Neutralino adapter: provides the same window.native API the Electron preload exposes,
// restores saved settings, then loads the app bundle.
(function () {
  const EXTS = /\.(stl|obj|3mf|ply|glb|gltf|fbx|amf|wrl|step|stp|iges|igs|brep)$/i;
  const MODEL_EXT = ['stl', 'obj', '3mf', 'ply', 'glb', 'gltf', 'fbx', 'amf', 'wrl', 'step', 'stp', 'iges', 'igs', 'brep'];
  const norm = (p) => String(p).replace(/\\/g, '/');
  const baseName = (p) => norm(p).split('/').pop();

  async function readModel(p) {
    const data = await Neutralino.filesystem.readBinaryFile(p);
    const name = baseName(p);
    return { name, path: p, ext: name.split('.').pop().toLowerCase(), data };
  }
  async function exists(p) {
    try { await Neutralino.filesystem.getStats(p); return true; } catch (e) { return false; }
  }

  window.native = {
    async openModel() {
      const r = await Neutralino.os.showOpenDialog('Open 3D model', {
        filters: [{ name: '3D models', extensions: MODEL_EXT }, { name: 'All files', extensions: ['*'] }],
      });
      if (!r || !r.length) return null;
      return readModel(r[0]);
    },
    readPath: readModel,
    pathForFile: () => null, // WebView: dropped files are read via File.arrayBuffer()
    async pendingFile() {
      const args = (window.NL_ARGS || []).slice(1);
      const f = args.find((a) => EXTS.test(a));
      return f ? readModel(f) : null;
    },
    async chooseFolder(suggested) {
      const opts = suggested ? { defaultPath: suggested } : {};
      const r = await Neutralino.os.showFolderDialog('Choose export folder', opts);
      return r || null;
    },
    async writeFiles(folder, sub, files) {
      const root = norm(folder).replace(/\/$/, '');
      let dir = `${root}/${sub}`; let n = 2;
      while (await exists(dir)) dir = `${root}/${sub} (${n++})`;
      await Neutralino.filesystem.createDirectory(dir);
      for (const f of files) await Neutralino.filesystem.writeBinaryFile(`${dir}/${f.name}`, f.data);
      return window.NL_OS === 'Windows' ? dir.replace(/\//g, '\\') : dir;
    },
    async showFolder(p) {
      if (window.NL_OS === 'Windows') await Neutralino.os.execCommand(`explorer "${p.replace(/\//g, '\\')}"`, { background: true });
      else await Neutralino.os.open('file://' + p);
    },
    onOpenPath() { /* single window; file associations pass the path as an argument */ },
  };

  // persistent settings: mirror modcut.* localStorage keys into Neutralino storage (the server port changes each run)
  const KEY = 'modcut_settings';
  let saveT = 0;
  function scheduleSave() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const o = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('modcut.')) o[k] = localStorage.getItem(k); }
      Neutralino.storage.setData(KEY, JSON.stringify(o)).catch(() => {});
    }, 300);
  }
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (String(k).startsWith('modcut.')) scheduleSave(); };

  function loadBundle() { const s = document.createElement('script'); s.src = 'bundle.js'; document.body.appendChild(s); }

  Neutralino.init();
  Neutralino.events.on('windowClose', () => Neutralino.app.exit());
  (async () => {
    try {
      const raw = await Neutralino.storage.getData(KEY);
      const o = JSON.parse(raw || '{}');
      for (const [k, v] of Object.entries(o)) origSet.call(localStorage, k, v);
    } catch (e) { /* first run: nothing saved yet */ }
    loadBundle();
  })();
})();
