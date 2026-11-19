const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopControls', {
  toggleFullscreen: () => ipcRenderer.invoke('game:fullscreen'),
  quit: () => ipcRenderer.invoke('game:quit'),
});
