// PrintPro Desktop — главный процесс Electron.
//
// Это ОБЁРТКА вокруг уже существующего кода (printpro-api + printpro-web).
// Здесь НЕТ бизнес-логики типографии — только: поднять встроенную базу,
// запустить API и веб-панель как дочерние процессы, показать окно.
// Правки кассы/заказов/отчётов делаются в printpro-api и printpro-web,
// а не здесь (см. docs/06-АРХИТЕКТУРА-КОРОБКА-ЭЛЕКТРОН.md, §2).
//
// Роли компьютера:
//   - "main" (главный) — держит встроенный Postgres + API + веб-сервер.
//   - "cash" (касса)   — просто окно, смотрящее на http://<mainHost>:3001.

'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const Store = require('electron-store');
const log = require('electron-log');
const EmbeddedPostgres = require('embedded-postgres');

const { schedulePgDumpBackups, runBackupOnce } = require('./backup');

// electron-log: пишем и в файл (userData/logs/main.log), и в консоль.
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
Object.assign(console, log.functions);

// ──────────────────────────────────────────────────────────────────────────
// 1. Пути. Всё «изменяемое» (база, файлы, бэкапы, настройки) хранится в
//    userData — это папка профиля Electron-приложения на диске клиента,
//    НЕ внутри установленной программы (иначе обновление всё сотрёт).
// ──────────────────────────────────────────────────────────────────────────

function getPaths() {
  const userData = app.getPath('userData');
  const pgData = path.join(userData, 'pgdata');
  const uploads = path.join(userData, 'uploads');
  const backups = path.join(userData, 'backups');
  const logs = path.join(userData, 'logs');

  // В собранном .exe ресурсы (printpro-api/dist, printpro-web, prisma) лежат
  // в process.resourcesPath (папка resources/ рядом с exe — задаётся полем
  // extraResources в electron-builder, см. package.json).
  // В режиме разработки (npm start из папки electron/, без упаковки) их там
  // нет — тогда берём из соседних папок монорепозитория (../printpro-api,
  // ../printpro-web), предполагая, что они уже собраны (`npm run build`).
  const resourcesRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..');

  const apiDir = app.isPackaged
    ? path.join(resourcesRoot, 'printpro-api')
    : path.join(resourcesRoot, 'printpro-api'); // в dev тоже ../printpro-api
  const webDir = app.isPackaged
    ? path.join(resourcesRoot, 'printpro-web')
    : path.join(resourcesRoot, 'printpro-web', '.next', 'standalone');

  return { userData, pgData, uploads, backups, logs, resourcesRoot, apiDir, webDir };
}

function ensureDirs(paths) {
  for (const p of [paths.pgData, paths.uploads, paths.backups, paths.logs]) {
    fs.mkdirSync(p, { recursive: true });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Настройки (роль ПК). Храним через electron-store — простой JSON-файл
//    в userData/config.json. ВАЖНО: electron-store с версии 9 стал чистым
//    ESM-модулем и перестаёт грузиться через require() в обычном (CJS)
//    главном процессе Electron — поэтому в package.json зафиксирована
//    версия "8.2.0" (последняя CJS-совместимая). Не обновлять без миграции
//    main.js на ESM/динамический import().
// ──────────────────────────────────────────────────────────────────────────

/** @type {{ role: 'main'|'cash'|null, mainHost: string, cloudSync: boolean, nodeId: string }} */
const store = new Store({
  name: 'config',
  defaults: {
    role: null, // не задано — покажем экран настройки при первом запуске
    mainHost: '', // адрес главного ПК (только для роли "cash"), напр. 192.168.1.50
    cloudSync: false, // галочка «синхронизировать с облаком» (для будущей Фазы 3)
    nodeId: '', // короткий код этой точки для sync-worker; генерируем при первом сохранении
    jwtSecret: '', // секрет подписи JWT; генерируем один раз при первом запуске (см. getOrCreateJwtSecret)
  },
});

// ──────────────────────────────────────────────────────────────────────────
// 3. Служебное состояние процесса
// ──────────────────────────────────────────────────────────────────────────

const API_PORT = 3000;
const WEB_PORT = 3001;
const PG_PORT = 5433; // не 5432 — чтобы не конфликтовать с системным Postgres, если он есть у клиента
const PG_USER = 'postgres';
const PG_PASSWORD = 'printpro_local'; // локальная встроенная БД, наружу не смотрит
const PG_DATABASE = 'printpro';

let mainWindow = null;
let setupWindow = null;
let apiProcess = null;
let webProcess = null;
/** @type {EmbeddedPostgres|null} */
let pg = null;
let backupTimer = null;

// ──────────────────────────────────────────────────────────────────────────
// 4. Вспомогательные функции
// ──────────────────────────────────────────────────────────────────────────

// JWT-секрет коробки. API в production (а коробка запускает его именно так)
// ТРЕБУЕТ JWT_SECRET (assertRequiredEnv в printpro-api/src/main.ts) — без него
// API упадёт на старте. Генерируем один раз и храним в config: постоянный секрет
// нужен, чтобы токены не инвалидировались при каждом перезапуске программы.
function getOrCreateJwtSecret() {
  let secret = store.get('jwtSecret');
  if (!secret) {
    secret = require('crypto').randomBytes(48).toString('hex');
    store.set('jwtSecret', secret);
  }
  return secret;
}

// IP этого компьютера в локальной сети — показываем на главном ПК, чтобы на
// кассах ввести те же цифры (см. §6 docs/06-АРХИТЕКТУРА-КОРОБКА-ЭЛЕКТРОН.md).
function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// Ждём, пока API ответит на /api/health (эндпоинт уже есть в printpro-api —
// HealthController, liveness). Если по какой-то причине не ответит за таймаут,
// веб-окно всё равно откроется чуть позже.
function waitForHttpOk(url, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve(true);
        } else if (Date.now() > deadline) {
          resolve(false);
        } else {
          setTimeout(attempt, intervalMs);
        }
      });
      req.on('error', () => {
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, intervalMs);
      });
      req.setTimeout(intervalMs, () => req.destroy());
    };
    attempt();
  });
}

// Запуск дочернего Node-процесса с логированием в electron-log.
function spawnNode(scriptPath, args, options) {
  const child = spawn(process.execPath, [scriptPath, ...(args || [])], {
    ...options,
    // ELECTRON_RUN_AS_NODE заставляет бинарник electron.exe вести себя как
    // обычный node — так не нужно тащить отдельный node.exe в дистрибутив.
    env: { ELECTRON_RUN_AS_NODE: '1', ...process.env, ...(options && options.env) },
    windowsHide: true,
  });
  child.stdout.on('data', (d) => log.info(`[${path.basename(scriptPath)}]`, d.toString().trim()));
  child.stderr.on('data', (d) => log.error(`[${path.basename(scriptPath)}]`, d.toString().trim()));
  child.on('exit', (code, signal) => {
    log.warn(`[${path.basename(scriptPath)}] завершился, код=${code} сигнал=${signal}`);
  });
  return child;
}

// ──────────────────────────────────────────────────────────────────────────
// 5. Встроенная база данных (роль "main")
// ──────────────────────────────────────────────────────────────────────────

async function ensureEmbeddedPostgres(paths) {
  // API пакета сверен с документацией embedded-postgres: конструктор
  // (databaseDir/user/password/port/persistent/onLog/onError) и методы
  // initialise()/start()/stop()/createDatabase() — актуальны.
  pg = new EmbeddedPostgres({
    databaseDir: paths.pgData,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
    // Вывод initdb/postgres направляем в electron-log.
    onLog: (msg) => log.info('[postgres]', msg),
    onError: (err) =>
      log.error('[postgres]', err && err.message ? err.message : err),
  });

  // initdb выполняем один раз — определяем «первый запуск» по отсутствию
  // служебного файла PG_VERSION в папке данных.
  const firstRun = !fs.existsSync(path.join(paths.pgData, 'PG_VERSION'));
  if (firstRun) {
    log.info('Встроенный Postgres: первый запуск, инициализация (initdb)...');
    await pg.initialise();
  }

  await pg.start();
  log.info(`Встроенный Postgres запущен на порту ${PG_PORT}`);

  // Создаём базу printpro, если её ещё нет (после initdb есть только служебные БД).
  try {
    await pg.createDatabase(PG_DATABASE);
  } catch (err) {
    // Уже существует — это нормально при повторных запусках.
    log.debug('createDatabase: база уже существует либо другая ошибка:', err.message);
  }

  return `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DATABASE}?schema=public`;
}

// Применяем миграции: `node prisma/build/index.js migrate deploy`.
// Используем CLI prisma напрямую (без npx — коробка работает офлайн).
function runPrismaMigrateDeploy(paths, databaseUrl) {
  return new Promise((resolve) => {
    // Точка входа prisma CLI — сверено с prisma v6:
    // node_modules/prisma/build/index.js.
    const prismaCli = path.join(paths.apiDir, 'node_modules', 'prisma', 'build', 'index.js');
    const schemaPath = path.join(paths.apiDir, 'prisma', 'schema.prisma');

    if (!fs.existsSync(prismaCli)) {
      log.error('Не найден prisma CLI по пути', prismaCli, '— миграции пропущены.');
      resolve(false);
      return;
    }

    const child = spawnNode(prismaCli, ['migrate', 'deploy', '--schema', schemaPath], {
      cwd: paths.apiDir,
      env: { DATABASE_URL: databaseUrl },
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

// Заводим компанию/админа компилируемым seed (dist/bootstrap/seed.js — уже есть
// в printpro-api, идемпотентный). Если по какой-то причине файл не найден — не
// роняем запуск, а предупреждаем в логе: без seed не будет ни компании, ни
// пользователя admin/admin123 для первого входа.
function runSeed(paths, databaseUrl) {
  return new Promise((resolve) => {
    const seedScript = path.join(paths.apiDir, 'dist', 'bootstrap', 'seed.js');
    if (!fs.existsSync(seedScript)) {
      log.warn(
        'dist/bootstrap/seed.js не найден — компания/админ не будут созданы автоматически. ' +
          'См. electron/README.md, раздел «Требуемые изменения в хосте», п.1.',
      );
      resolve(false);
      return;
    }
    const child = spawnNode(seedScript, [], {
      cwd: paths.apiDir,
      // BOX_MODE=1 — seed сгенерирует СВОЙ companyId для этой установки коробки
      // (у каждого клиента свой tenant), а не фиксированный облачный.
      env: { DATABASE_URL: databaseUrl, BOX_MODE: '1' },
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 6. Запуск API и веб-панели как дочерних процессов
// ──────────────────────────────────────────────────────────────────────────

function startApiProcess(paths, databaseUrl) {
  const mainScript = path.join(paths.apiDir, 'dist', 'main.js');
  apiProcess = spawnNode(mainScript, [], {
    cwd: paths.apiDir,
    env: {
      DATABASE_URL: databaseUrl,
      PORT: String(API_PORT),
      NODE_ENV: 'production',
      // Секрет подписи JWT (обязателен в production) — постоянный для этой установки.
      JWT_SECRET: getOrCreateJwtSecret(),
      // Папка загруженных файлов — ВНЕ установленной программы, в userData,
      // чтобы обновление приложения не стирало файлы клиентов. printpro-api
      // уже читает UPLOADS_DIR (main.ts + image-upload.options.ts).
      UPLOADS_DIR: paths.uploads,
      // Короткий код этой точки — нужен sync-worker'у (Фаза 3); пока не
      // используется, но пробрасываем заранее.
      NODE_ID: store.get('nodeId') || 'BOX',
      // Разрешить CORS для адресов локальной сети в production-сборке (кассы
      // ходят к главному ПК по LAN-IP). printpro-api уже поддерживает флаг
      // ALLOW_LAN_ORIGINS (main.ts), развязанный от NODE_ENV.
      ALLOW_LAN_ORIGINS: '1',
    },
  });
}

function startWebProcess(paths) {
  // Standalone-сборка Next.js кладёт точку входа в server.js в корне
  // .next/standalone (при упаковке extraResources копирует именно
  // содержимое .next/standalone в resources/printpro-web — см. package.json).
  const serverScript = path.join(paths.webDir, 'server.js');
  webProcess = spawnNode(serverScript, [], {
    cwd: paths.webDir,
    env: {
      PORT: String(WEB_PORT),
      // 0.0.0.0 — слушать на всех интерфейсах, чтобы кассы по LAN достучались
      // до главного ПК (не только 127.0.0.1).
      HOSTNAME: '0.0.0.0',
      NODE_ENV: 'production',
      // ВАЖНО: сознательно НЕ задаём NEXT_PUBLIC_API_BASE / NEXT_PUBLIC_SERVER_ORIGIN.
      // printpro-web/src/lib/config.ts уже умеет сам определять адрес API по
      // window.location.hostname (localhost/LAN → тот же хост:3000/api,
      // иначе → облако). Это ровно то, что нужно и главному ПК, и кассам —
      // трогать не нужно, работает «из коробки». Если эти переменные будут
      // заданы жёстко на этапе сборки printpro-web, LAN-автоопределение
      // сломается для касс (см. README, раздел про сборку веб-части).
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 7. Окна
// ──────────────────────────────────────────────────────────────────────────

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 560,
    height: 640,
    resizable: false,
    title: 'PrintPro — настройка',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow.setMenuBarVisibility(false);
  setupWindow.loadFile(path.join(__dirname, 'setup.html'));
}

function createMainWindow(targetUrl, roleLabel) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: `PrintPro — ${roleLabel}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // На главном ПК показываем LAN-адрес в заголовке окна — чтобы на кассах
  // ввести те же цифры без «конфигов руками» (см. §6 архитектурной доки).
  if (store.get('role') === 'main') {
    const ip = getLanIp();
    mainWindow.setTitle(`PrintPro — главный компьютер (адрес для касс: ${ip})`);
    buildMainMenu(ip);
  } else {
    Menu.setApplicationMenu(null);
  }

  mainWindow.loadURL(targetUrl);

  // Внешние ссылки (если где-то есть target=_blank) открываем в системном
  // браузере, а не создаём второе Electron-окно.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMainMenu(lanIp) {
  const template = [
    {
      label: 'PrintPro',
      submenu: [
        {
          label: `Адрес для касс: ${lanIp}:${WEB_PORT}`,
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Адрес для касс',
              message: 'На кассах в браузере/приложении введите этот адрес:',
              detail: `${lanIp}:${WEB_PORT}`,
            });
          },
        },
        { label: 'Сделать резервную копию сейчас', click: () => runBackupOnce(getBackupContext()) },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' },
      ],
    },
    { role: 'viewMenu', label: 'Вид' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Папка с бинарниками Postgres (в т.ч. pg_dump). Пакет embedded-postgres тянет
// их из zonky и кладёт в scoped-пакеты node_modules/@embedded-postgres/<os>-<arch>/
// native/bin (в собранном .exe — внутри распакованного asar/resources). Ищем
// динамически; если структура пакета отличается — backup.js gracefully пропустит.
function findPgBinDir() {
  const roots = [
    path.join(__dirname, 'node_modules', '@embedded-postgres'),
    path.join(process.resourcesPath || __dirname, 'app.asar.unpacked', 'node_modules', '@embedded-postgres'),
  ];
  for (const scopeDir of roots) {
    try {
      if (!fs.existsSync(scopeDir)) continue;
      for (const pkg of fs.readdirSync(scopeDir)) {
        const bin = path.join(scopeDir, pkg, 'native', 'bin');
        if (fs.existsSync(bin)) return bin;
      }
    } catch {
      // недоступно — пробуем следующий корень
    }
  }
  return null;
}

function getBackupContext() {
  const paths = getPaths();
  return {
    pgBinDir: findPgBinDir(),
    databaseUrl: `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DATABASE}?schema=public`,
    backupsDir: paths.backups,
    keep: 14,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 8. Оркестрация запуска
// ──────────────────────────────────────────────────────────────────────────

async function startAsMain() {
  const paths = getPaths();
  ensureDirs(paths);

  const databaseUrl = await ensureEmbeddedPostgres(paths);
  await runPrismaMigrateDeploy(paths, databaseUrl);
  await runSeed(paths, databaseUrl);

  startApiProcess(paths, databaseUrl);
  const apiReady = await waitForHttpOk(`http://127.0.0.1:${API_PORT}/api/health`, { timeoutMs: 30000 });
  if (!apiReady) {
    log.warn('API не ответил на /api/health за отведённое время — открываем окно всё равно.');
  }

  startWebProcess(paths);
  await waitForHttpOk(`http://127.0.0.1:${WEB_PORT}`, { timeoutMs: 30000 });

  createMainWindow(`http://127.0.0.1:${WEB_PORT}`, 'главный компьютер');

  // Плановый бэкап — раз в 6 часов, ротация хранится в backup.js.
  // TODO(build): вынести интервал в настройки (setup.html) при желании.
  backupTimer = schedulePgDumpBackups(getBackupContext(), 6 * 60 * 60 * 1000);
}

function startAsCash() {
  const mainHost = store.get('mainHost');
  if (!mainHost) {
    // Некорректная конфигурация — возвращаем на экран настройки.
    store.set('role', null);
    createSetupWindow();
    return;
  }
  createMainWindow(`http://${mainHost}:${WEB_PORT}`, `касса (главный: ${mainHost})`);
}

async function startByRole() {
  const role = store.get('role');
  if (role === 'main') {
    await startAsMain();
  } else if (role === 'cash') {
    startAsCash();
  } else {
    createSetupWindow();
  }

  // Проверка обновлений — не должна ронять приложение, если канал ещё не
  // настроен (владелец выберет: свой сайт или GitHub Releases, см. README).
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log.warn('Проверка обновлений не удалась (это нормально, если канал ещё не настроен):', err.message);
    });
  } catch (err) {
    log.warn('electron-updater недоступен:', err.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 9. IPC — мост с экраном настройки (setup.html / preload.js)
// ──────────────────────────────────────────────────────────────────────────

ipcMain.handle('config:get', () => store.store);

ipcMain.handle('config:get-lan-ip', () => getLanIp());

ipcMain.handle('config:save', async (_event, config) => {
  // config: { role: 'main'|'cash', mainHost?: string, cloudSync: boolean }
  if (!config || (config.role !== 'main' && config.role !== 'cash')) {
    throw new Error('Некорректная роль ПК');
  }
  store.set('role', config.role);
  store.set('mainHost', config.mainHost || '');
  store.set('cloudSync', !!config.cloudSync);
  if (!store.get('nodeId')) {
    // Короткий уникальный код этой точки (для будущей синхронизации, Фаза 3).
    store.set('nodeId', `BOX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
  }

  // Простой и надёжный способ перейти от экрана настройки к рабочему режиму —
  // перезапустить приложение. Дочерние процессы (если были) корректно
  // остановятся в обработчике before-quit.
  app.relaunch();
  app.exit(0);
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 10. Жизненный цикл приложения
// ──────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  startByRole().catch((err) => {
    log.error('Ошибка запуска:', err);
    dialog.showErrorBox('PrintPro — ошибка запуска', String(err && err.stack ? err.stack : err));
  });
});

app.on('window-all-closed', () => {
  // На Windows/Linux закрытие всех окон обычно означает выход из приложения
  // целиком (в отличие от macOS, где принято оставлять процесс в доке).
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    startByRole().catch((err) => log.error('Ошибка перезапуска окна:', err));
  }
});

// Гасим дочерние процессы (API, веб, встроенный Postgres) перед выходом —
// иначе они останутся «висеть» в фоне после закрытия окна.
let shuttingDown = false;
app.on('before-quit', async (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  event.preventDefault();

  log.info('Остановка PrintPro Desktop...');
  if (backupTimer) clearInterval(backupTimer);

  if (webProcess) webProcess.kill();
  if (apiProcess) apiProcess.kill();

  if (pg) {
    try {
      await pg.stop();
      log.info('Встроенный Postgres остановлен.');
    } catch (err) {
      log.error('Ошибка остановки Postgres:', err);
    }
  }

  app.exit(0);
});
