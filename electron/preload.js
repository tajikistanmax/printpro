// PrintPro Desktop — preload-скрипт.
//
// Работает с контекстной изоляцией (contextIsolation: true), поэтому
// напрямую пробрасывать Node.js/Electron API в окно нельзя (небезопасно —
// окно грузит наш же printpro-web, но лучше сразу делать правильно).
// Наружу (в window.electronAPI) отдаём только то, что реально нужно
// экрану первого запуска (setup.html/setup.js) — минимальный мост.
//
// Основные окна (главный ПК с загруженным printpro-web, касса) этот мост
// тоже получают, но веб-приложению он не нужен и не используется —
// это просто общий preload для всех BrowserWindow в main.js.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Минимальный мост рабочего окна: веб-приложение может только сообщить о
// закрытии смены. Конфигурация, секреты и восстановление базы ему недоступны.
contextBridge.exposeInMainWorld('electronAPI', {
  notifyShiftClosed: () => ipcRenderer.invoke('backup:shift-closed'),
});
