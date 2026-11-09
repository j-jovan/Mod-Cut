const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('native', {
  openModel: () => ipcRenderer.invoke('open-model'),
  readPath: (p) => ipcRenderer.invoke('read-path', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  pendingFile: () => ipcRenderer.invoke('pending-file'),
  chooseFolder: (s) => ipcRenderer.invoke('choose-folder', s),
  writeFiles: (folder, sub, files) => ipcRenderer.invoke('write-files', folder, sub, files),
  showFolder: (p) => ipcRenderer.invoke('show-folder', p),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
});
