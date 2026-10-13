const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
}

contextBridge.exposeInMainWorld('inplan', {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  chooseRoot: () => ipcRenderer.invoke('dialog:chooseRoot'),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  startUpload: (payload) => ipcRenderer.invoke('upload:start', payload),
  testConnection: (payload) => ipcRenderer.invoke('upload:testConnection', payload),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  openLogsFolder: () => ipcRenderer.invoke('logs:openFolder'),
  contactSupport: () => ipcRenderer.invoke('support:contact'),
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openReleasesPage: () => ipcRenderer.invoke('update:openReleases'),
  onLog: (callback) => subscribe('log:entry', callback),
  onUpdateState: (callback) => subscribe('update:state', callback),
});
