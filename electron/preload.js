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

contextBridge.exposeInMainWorld('electronAPI', {
  // Прочитать уже сохранённую конфигурацию (роль/адрес/облако), если
  // пользователь вернулся на экран настройки.
  getConfig: () => ipcRenderer.invoke('config:get'),

  // IP этого компьютера в локальной сети — показываем на экране настройки
  // главного ПК, чтобы владелец мог сразу продиктовать его для касс.
  getLanIp: () => ipcRenderer.invoke('config:get-lan-ip'),

  // Сохранить выбор роли ПК. Главный процесс сам перезапустит приложение
  // после сохранения (см. main.js, ipcMain.handle('config:save', ...)).
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),

  // Резервные копии (для экрана настройки главного ПК):
  // — инфо о текущей папке копий и найденных дисках;
  getBackupInfo: () => ipcRenderer.invoke('config:get-backup-info'),
  // — открыть диалог выбора папки для копий (возвращает выбранный путь или null);
  pickBackupDir: () => ipcRenderer.invoke('config:pick-backup-dir'),
  // — восстановить базу из копии при первом запуске (после переустановки Windows).
  restoreAtSetup: () => ipcRenderer.invoke('backup:restore-at-setup'),

  // Веб-панель зовёт это при закрытии смены (Z-отчёт) — коробка делает резервную
  // копию базы (основной момент копии: день завершён). В облаке метода нет.
  notifyShiftClosed: () => ipcRenderer.invoke('backup:shift-closed'),
});
