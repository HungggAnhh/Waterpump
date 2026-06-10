// desktop/preload.js
console.log('[PRELOAD_ACTUALLY_RUNNING]');

try {
  console.log('[PRELOAD_EXPOSING]');
  const { contextBridge, ipcRenderer } = require('electron');

  const api = {
    isElectron: () => true,
    captureScreen: (options = { excludeSelf: true }) => {
      ipcRenderer.send('trigger-screenshot', options);
    },
    onScreenshotCaptured: (callback) => {
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
    },
    getClipboardImage: () => {
      return ipcRenderer.invoke('clipboard-read-image');
    },
    deleteTempFile: (filePath) => {
      return ipcRenderer.invoke('delete-temp-file', filePath);
    }
  };

  contextBridge.exposeInMainWorld('electronAPI', api);
  console.log('[PRELOAD_EXPOSED]');

  contextBridge.exposeInMainWorld('debugApi', {
    ping: () => 'pong'
  });
} catch (error) {
  console.error('[PRELOAD_CRASH]', error);
}
