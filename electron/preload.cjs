const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPos', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
});
