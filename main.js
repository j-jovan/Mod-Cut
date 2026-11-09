const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, 'app');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
let pendingFile = null;

function fileFromArgs(argv) {
  const exts = /\.(stl|obj|3mf|ply|glb|gltf|fbx|amf|wrl|step|stp|iges|igs|brep)$/i;
  return argv.slice(1).find((a) => exts.test(a) && fs.existsSync(a)) || null;
}

function readModel(p) {
  const data = fs.readFileSync(p);
  return { name: path.basename(p), path: p, ext: path.extname(p).slice(1).toLowerCase(), data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1100, minHeight: 700,
    backgroundColor: '#17181b', title: 'ModCut',
    icon: path.join(APP_DIR, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  win.loadURL('app://local/index.html');
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgs(argv);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (f) win.webContents.send('open-path', f); }
  });
  app.whenReady().then(() => {
    protocol.handle('app', async (req) => {
      const u = new URL(req.url);
      let rel = decodeURIComponent(u.pathname);
      const fp = path.normalize(path.join(APP_DIR, rel));
      if (!fp.startsWith(APP_DIR)) return new Response('forbidden', { status: 403 });
      try {
        const data = await fs.promises.readFile(fp);
        return new Response(data, { headers: { 'content-type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' } });
      } catch (e) { return new Response('not found', { status: 404 }); }
    });
    pendingFile = fileFromArgs(process.argv);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}

ipcMain.handle('pending-file', () => { const f = pendingFile; pendingFile = null; return f ? readModel(f) : null; });

ipcMain.handle('open-model', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open 3D model', properties: ['openFile'],
    filters: [
      { name: '3D models', extensions: ['stl', 'obj', '3mf', 'ply', 'glb', 'gltf', 'fbx', 'amf', 'wrl', 'step', 'stp', 'iges', 'igs', 'brep'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return readModel(r.filePaths[0]);
});

ipcMain.handle('read-path', (_e, p) => readModel(p));

ipcMain.handle('choose-folder', async (_e, suggested) => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose export folder', properties: ['openDirectory', 'createDirectory'], defaultPath: suggested || app.getPath('documents') });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle('write-files', async (_e, folder, sub, files) => {
  let dir = path.join(folder, sub);
  let n = 2;
  while (fs.existsSync(dir)) dir = path.join(folder, `${sub} (${n++})`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f.name), Buffer.from(f.data));
  return dir;
});

ipcMain.handle('show-folder', (_e, p) => shell.openPath(p));
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
