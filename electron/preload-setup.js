'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Этот мост подключается только к локальному setup.html. Рабочее веб-окно
// использует отдельный preload.js без доступа к конфигурации и восстановлению.
contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getLanIp: () => ipcRenderer.invoke('config:get-lan-ip'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getBackupInfo: () => ipcRenderer.invoke('config:get-backup-info'),
  pickBackupDir: () => ipcRenderer.invoke('config:pick-backup-dir'),
  restoreAtSetup: () => ipcRenderer.invoke('backup:restore-at-setup'),
});
