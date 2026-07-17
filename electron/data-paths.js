// PrintPro — общий модуль путей к ИЗМЕНЯЕМЫМ данным (база, загрузки, копии,
// настройки). Специально НЕ зависит от Electron: его подключают и главный
// процесс Electron (main.js), и headless-служба (server-host.js, запускается
// как обычный Node через ELECTRON_RUN_AS_NODE).
//
// ЗАЧЕМ ОБЩЕСИСТЕМНАЯ ПАПКА. Служба Windows работает от учётки SYSTEM, а окно
// программы — от залогиненного пользователя. Если хранить данные в профиле
// пользователя (%APPDATA%), служба и окно будут смотреть в РАЗНЫЕ папки и
// «увидят» разные базы. Поэтому единое место — общесистемная папка:
//   C:\ProgramData\PrintPro
// Установщик (NSIS, с правами админа) выдаёт на неё права на запись обычным
// пользователям (icacls), чтобы и служба, и окно могли туда писать.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Корень изменяемых данных. Переопределяется env PRINTPRO_DATA_DIR
// (используется для тестов и для аккуратного переноса на другую машину).
function getDataRoot() {
  if (process.env.PRINTPRO_DATA_DIR) return process.env.PRINTPRO_DATA_DIR;
  const programData = process.env.ProgramData || process.env.PROGRAMDATA;
  if (process.platform === 'win32' && programData) {
    return path.join(programData, 'PrintPro');
  }
  // Не-Windows / дев-окружение: папка в домашнем каталоге (в проде это всегда win32).
  return path.join(os.homedir(), '.printpro-data');
}

function getDataPaths() {
  const root = getDataRoot();
  return {
    root,
    pgData: path.join(root, 'pgdata'),
    uploads: path.join(root, 'uploads'),
    backups: path.join(root, 'backups'),
    logs: path.join(root, 'logs'),
    configFile: path.join(root, 'config.json'),
  };
}

function ensureDataDirs() {
  const p = getDataPaths();
  for (const dir of [p.root, p.pgData, p.uploads, p.backups, p.logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return p;
}

// Конфиг — ТОТ ЖЕ JSON-файл, что пишет electron-store в main.js (там задан
// cwd = getDataRoot()). electron-store хранит плоский JSON без обёртки, поэтому
// служба читает его напрямую. Пустой объект, если файла ещё нет.
function readConfig() {
  const file = getDataPaths().configFile;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// Атомарная запись конфига (через .tmp + rename), совместимая по формату с
// electron-store. Используется службой, когда нужно один раз сгенерировать и
// сохранить секрет (напр. jwtSecret) при первом запуске «служба раньше окна».
function writeConfig(obj) {
  const p = ensureDataDirs();
  const tmp = p.configFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, '\t'));
  fs.renameSync(tmp, p.configFile);
}

module.exports = { getDataRoot, getDataPaths, ensureDataDirs, readConfig, writeConfig };
