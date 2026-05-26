// desktop/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: () => true,
  captureScreen: (options = { excludeSelf: true }) => {
    ipcRenderer.send('trigger-screenshot', options);
  },
  onScreenshotCaptured: (callback) => {
    // Xóa listener cũ trước khi gắn listener mới để tránh chồng chéo (duplicate listener)
    ipcRenderer.removeAllListeners('screenshot-captured');
    ipcRenderer.on('screenshot-captured', (event, filePath) => {
      callback(filePath);
    });
  },
  readImageFile: (filePath) => {
    return ipcRenderer.invoke('read-image-file', filePath);
  },
  onInitScreenshotData: (callback) => {
    ipcRenderer.on('init-screenshot-data', (event, data) => {
      callback(data);
    });
  },
  saveTempCrop: (arrayBuffer) => {
    return ipcRenderer.invoke('save-temp-crop', arrayBuffer);
  },
  cancelScreenshot: () => {
    ipcRenderer.send('cancel-screenshot');
  }
});
