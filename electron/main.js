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
const net = require('net');
const { spawn } = require('child_process');
const Store = require('electron-store');
const log = require('electron-log');
// ВНИМАНИЕ: embedded-postgres v17 — чистый ESM ("type":"module"), его НЕЛЬЗЯ
// грузить через require() из CJS-главного процесса (иначе ERR_REQUIRE_ESM и
// приложение падает на старте). Загружаем динамическим import() ниже, внутри
// async-функции ensureEmbeddedPostgres(). Та же причина, что и с electron-store
// (см. комментарий у секции настроек).

// Модуль резервных копий: «холодная копия» папки данных Postgres + восстановление.
// (pg_dump в комплекте embedded-postgres нет — см. backup.js, шапка.)
const backup = require('./backup');

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
    // Папка для резервных копий базы ВНЕ диска C (флешка/внешний диск/диск D).
    // Пусто — копии пишутся только локально (диск C) + показываем предупреждение,
    // потому что при переустановке Windows такие копии пропадают вместе с базой.
    backupDir: '',
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

// Мажорная версия встроенного Postgres (пакет embedded-postgres 17.x). Нужна
// восстановлению: копию можно ставить только в кластер той же мажорной версии.
// При обновлении embedded-postgres на новый мажор — поменять здесь.
const PG_MAJOR = '17';

// Сколько копий храним и как часто пишем «фоновые» копии (запуск/закрытие
// программы). Локальные (диск C) — на случай порчи базы при живом диске; внешние
// (флешка/диск D) — переживают переустановку Windows.
const LOCAL_KEEP = 5;
const EXTERNAL_KEEP = 10;
// Основная копия делается при ЗАКРЫТИИ СМЕНЫ (Z-отчёт) — это раз в день, с
// полными данными за день (см. IPC 'backup:shift-closed'). А копии при
// запуске/закрытии ПРОГРАММЫ — лишь подстраховка и потому throttled: не чаще
// раза в сутки. Иначе, если программу открывают/закрывают по многу раз в день,
// копий было бы слишком много (износ флешки + ротация съедала бы историю).
const BACKUP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // подстраховочная копия — не чаще раза в сутки
// Минимальный зазор между копиями «при закрытии смены» — на случай, если веб
// пришлёт сигнал повторно (перерисовка/двойной клик); закрытий смен в день мало.
const SHIFT_BACKUP_MIN_GAP_MS = 10 * 60 * 1000;

let mainWindow = null;
let setupWindow = null;
let apiProcess = null;
let webProcess = null;
/** @type {EmbeddedPostgres|null} */
let pg = null;
// Флаг «идёт остановка/перезапуск» — чтобы обработчик before-quit не дублировал
// остановку процессов, когда мы уже сделали её вручную (напр., при восстановлении).
let shuttingDown = false;
// Флаг «сейчас делается копия с приостановкой базы» — чтобы не запустить две
// параллельно (напр., ручная копия и копия при закрытии смены одновременно).
let backupInProgress = false;
// Время последней копии «при закрытии смены» — для минимального зазора.
let lastShiftBackupAt = 0;

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

// Оборачивает promise таймаутом: если встроенный Postgres «зависнет» (например,
// initdb.exe не найден по пути и spawn не вернёт ни close, ни error — у
// embedded-postgres нет обработчика 'error'), пользователь увидит понятную
// ошибку, а не вечный спиннер.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Таймаут (${Math.round(ms / 1000)}с): ${label}`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function ensureEmbeddedPostgres(paths) {
  // embedded-postgres — ESM-only, поэтому грузим через динамический import()
  // (require() бросил бы ERR_REQUIRE_ESM). default-экспорт = класс EmbeddedPostgres.
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  // Диагностика путей к серверным бинарникам Postgres. В собранном .exe пакеты
  // embedded-postgres / @embedded-postgres лежат в app.asar.unpacked (см.
  // asarUnpack) — иначе spawn(initdb) не находит .exe внутри asar и процесс
  // инициализации зависает. Логируем реальные пути и их наличие.
  try {
    const winBins = await withTimeout(
      import('@embedded-postgres/windows-x64'),
      15000,
      'загрузка @embedded-postgres/windows-x64',
    );
    log.info(
      `[pg-bins] initdb=${winBins.initdb} exists=${fs.existsSync(winBins.initdb)}`,
    );
    log.info(
      `[pg-bins] postgres=${winBins.postgres} exists=${fs.existsSync(winBins.postgres)}`,
    );
  } catch (e) {
    log.error(
      '[pg-bins] не удалось получить пути к бинарникам Postgres: ' +
        (e && e.message ? e.message : e),
    );
  }

  // API пакета сверен с документацией embedded-postgres: конструктор
  // (databaseDir/user/password/port/persistent/onLog/onError) и методы
  // initialise()/start()/stop()/createDatabase() — актуальны.
  pg = new EmbeddedPostgres({
    databaseDir: paths.pgData,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
    // ВАЖНО: кодировка БД — строго UTF8. По умолчанию initdb берёт локаль
    // системы (на русской Windows это WIN1251), а миграции/данные содержат
    // Unicode-символы (например «→» в комментарии миграции, эмодзи, разные
    // языки) — в WIN1251 они не влезают и миграция падает (SqlState 22P05).
    // locale=C делает кластер независимым от системной локали (сортировка —
    // побайтовая; для типографии не критично, зато одинаково на любой машине).
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
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
    await withTimeout(pg.initialise(), 120000, 'инициализация Postgres (initdb)');
  }

  await withTimeout(pg.start(), 60000, 'запуск Postgres');
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
        { type: 'separator' },
        { label: 'Сделать резервную копию сейчас', click: () => doBackupNow() },
        {
          label: 'Папка для копий: ' + (store.get('backupDir') || 'не задана') + ' — изменить…',
          click: () => pickBackupDir(mainWindow),
        },
        { label: 'Восстановить из копии…', click: () => restoreFromBackupInteractive(mainWindow) },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' },
      ],
    },
    { role: 'viewMenu', label: 'Вид' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ──────────────────────────────────────────────────────────────────────────
// 7.1. Резервные копии: место хранения и определение дисков
// ──────────────────────────────────────────────────────────────────────────

// Буква системного диска (обычно "C"). Копии, лежащие на нём, НЕ переживают
// переустановку Windows — их складываем только как локальную страховку.
function systemDriveLetter() {
  return (process.env.SystemDrive || 'C:').charAt(0).toUpperCase();
}

// Лежит ли путь на системном диске (C:)?
function isOnSystemDrive(p) {
  try {
    const root = path.parse(path.resolve(p)).root.toUpperCase();
    return root.startsWith(systemDriveLetter());
  } catch {
    return false;
  }
}

// Диски, пригодные для копий (все существующие, кроме системного). Пробуем буквы
// D..Z (A/B — исторически дискеты, C — система). Так подсказываем клиенту флешку
// или второй диск.
function detectBackupDrives() {
  const sys = systemDriveLetter();
  const found = [];
  for (let code = 'D'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
    const letter = String.fromCharCode(code);
    if (letter === sys) continue;
    const root = letter + ':\\';
    try {
      if (fs.existsSync(root)) found.push(root);
    } catch {
      /* диск недоступен — пропускаем */
    }
  }
  return found;
}

// Эффективная внешняя папка для копий: то, что указал владелец, если она сейчас
// доступна для записи (флешку могли вынуть — тогда молча пропускаем внешнюю
// копию, не роняя приложение). Возвращает '' если не задана/недоступна.
function getExternalBackupDir() {
  const d = String(store.get('backupDir') || '').trim();
  if (!d) return '';
  try {
    fs.mkdirSync(d, { recursive: true }); // создаст, если папки ещё нет; бросит, если носитель недоступен
    return d;
  } catch (err) {
    log.warn('backup: указанная папка для копий недоступна (' + d + '): ' + (err && err.message ? err.message : err));
    return '';
  }
}

// Делает резервные копии базы: всегда локально (диск C, страховка от порчи базы)
// и, если задана и доступна, во внешнюю папку (флешка/диск D — переживает
// переустановку Windows). ВАЖНО: вызывать только когда Postgres ОСТАНОВЛЕН
// (при старте до pg.start(), при выходе после pg.stop()), иначе копия может
// оказаться несогласованной. Возвращает список результатов для показа человеку.
function runBackups({ force = false, note } = {}) {
  const paths = getPaths();
  const appVersion = app.getVersion();
  const minInterval = force ? 0 : BACKUP_MIN_INTERVAL_MS;
  const results = [];

  // 1) Локальная копия (диск C). Полезна, если база повредилась, а диск цел.
  results.push({
    where: 'на этом компьютере',
    dir: paths.backups,
    ...backup.coldCopy({
      pgDataDir: paths.pgData,
      destRoot: paths.backups,
      keep: LOCAL_KEEP,
      minIntervalMs: minInterval,
      force,
      appVersion,
      note,
    }),
  });

  // 2) Внешняя копия (флешка/диск D) — главная защита от переустановки Windows.
  const ext = getExternalBackupDir();
  if (ext) {
    results.push({
      where: 'на внешнем носителе',
      dir: ext,
      ...backup.coldCopy({
        pgDataDir: paths.pgData,
        destRoot: ext,
        keep: EXTERNAL_KEEP,
        minIntervalMs: minInterval,
        force,
        appVersion,
        note,
      }),
    });
  }

  for (const r of results) {
    if (r.ok && !r.skipped) log.info(`backup: копия ${r.where} готова → ${r.dest}`);
    else if (r.skipped) log.info(`backup: копия ${r.where} пропущена (${r.reason || 'нет причины'})`);
    else log.warn(`backup: копия ${r.where} НЕ создана: ${r.reason || 'ошибка'}`);
  }
  return results;
}

// ──────────────────────────────────────────────────────────────────────────
// 8. Оркестрация запуска
// ──────────────────────────────────────────────────────────────────────────

// Проверяет, свободен ли TCP-порт (пытаемся встать на него сервером). host=null
// → слушаем ВСЕ интерфейсы (как это делают API на '::' и web на 0.0.0.0). Это
// важно: проверка только на 127.0.0.1 НЕ ловит конфликт с программой, занявшей
// 0.0.0.0:PORT (Windows разрешает отдельный bind на loopback) — а именно так и
// падал API с EADDRINUSE, хотя порт «казался» свободным.
function isPortFree(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    if (host) srv.listen(port, host);
    else srv.listen(port);
  });
}

// Перед запуском главного ПК убеждаемся, что нужные порты свободны. Иначе —
// понятная ошибка (а не тихий полу-запуск: раньше при занятом 3000/3001 API/web
// молча не поднимались, и пользователь видел пустую/битую панель без объяснения).
async function assertPortsFree() {
  const checks = [
    // Postgres слушает только 127.0.0.1 — проверяем там же.
    { port: PG_PORT, host: '127.0.0.1', what: 'встроенная база данных' },
    // API ('::') и web (0.0.0.0) слушают ВСЕ интерфейсы — проверяем так же
    // (host=null), иначе не поймаем чужой bind на 0.0.0.0:PORT.
    { port: API_PORT, host: null, what: 'API-сервер' },
    { port: WEB_PORT, host: null, what: 'веб-панель' },
  ];
  const busy = [];
  for (const c of checks) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await isPortFree(c.port, c.host))) {
      busy.push(`порт ${c.port} — ${c.what}`);
    }
  }
  if (busy.length) {
    throw new Error(
      'Не удаётся запустить PrintPro — нужные порты заняты другой программой:\n\n  ' +
        busy.join('\n  ') +
        '\n\nЧаще всего это уже запущенный экземпляр PrintPro или сервер разработки.\n' +
        'Закройте эту программу и запустите PrintPro снова.',
    );
  }
}

// Короткое описание результата копий для показа человеку.
function describeBackupResults(results) {
  const lines = [];
  for (const r of results) {
    if (r.ok && !r.skipped) lines.push(`✓ ${r.where}: ${r.dir}`);
    else if (r.ok && r.skipped) lines.push(`• ${r.where}: пропущено (${r.reason || 'свежая копия уже есть'})`);
    else lines.push(`✗ ${r.where}: не удалось (${r.reason || 'ошибка'})`);
  }
  return lines.join('\n');
}

// Выбор папки для копий (диалог). Ведём клиента на флешку/диск D (кроме C).
// Возвращает выбранный путь или null. Обновляет меню, чтобы показать новый путь.
async function pickBackupDir(parentWindow) {
  const drives = detectBackupDrives();
  const defaultPath = drives.length ? path.join(drives[0], 'PrintPro-Копии') : undefined;
  const res = await dialog.showOpenDialog(parentWindow || undefined, {
    title: 'Папка для резервных копий (лучше флешка или другой диск, не C:)',
    defaultPath,
    buttonLabel: 'Выбрать эту папку',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
  const chosen = res.filePaths[0];

  if (isOnSystemDrive(chosen)) {
    const proceed = dialog.showMessageBoxSync(parentWindow || undefined, {
      type: 'warning',
      title: 'Папка на системном диске',
      message: 'Эта папка находится на системном диске (C:).',
      detail:
        'При переустановке Windows копии в ней пропадут вместе с базой. ' +
        'Лучше выбрать флешку или другой диск (D:). Всё равно использовать эту папку?',
      buttons: ['Выбрать другую', 'Использовать всё равно'],
      defaultId: 0,
      cancelId: 0,
    });
    if (proceed !== 1) return null;
  }

  store.set('backupDir', chosen);
  log.info('backup: папка для копий = ' + chosen);
  if (store.get('role') === 'main' && mainWindow) buildMainMenu(getLanIp());
  return chosen;
}

// Безопасная копия, когда база ЗАПУЩЕНА (роль main). Копию нельзя снимать с
// работающего кластера, поэтому ненадолго останавливаем Postgres, копируем, снова
// поднимаем — после выхода процесса записи в pgdata нет, копия консистентна.
// Касса на эти секунды переподключится. Две такие копии сразу не запускаем
// (backupInProgress). Если поднять базу обратно не удалось — перезапускаем
// приложение (надёжное восстановление рабочего состояния).
async function safeBackupWhileRunning({ note } = {}) {
  if (store.get('role') !== 'main' || !pg) return { ok: false, reason: 'не главный ПК' };
  if (backupInProgress) return { ok: false, reason: 'копия уже выполняется' };
  backupInProgress = true;
  try {
    await pg.stop();
    const results = runBackups({ force: true, note });
    await pg.start();
    return { ok: true, results };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    log.error('safeBackup: не удалось (' + msg + ') — перезапуск приложения');
    dialog.showErrorBox(
      'Резервная копия',
      'Не удалось завершить копию: ' + msg + '\nПрограмма перезапустится.',
    );
    app.relaunch();
    app.exit(0);
    return { ok: false, reason: msg, relaunching: true };
  } finally {
    backupInProgress = false;
  }
}

// «Сделать резервную копию сейчас» (меню): подтверждение + показ результата.
async function doBackupNow() {
  if (store.get('role') !== 'main' || !pg) {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: 'Резервная копия',
      message: 'Резервную копию делает только главный компьютер (где хранится база).',
    });
    return;
  }
  const confirm = dialog.showMessageBoxSync(mainWindow || undefined, {
    type: 'question',
    title: 'Резервная копия',
    message: 'Создать резервную копию базы сейчас?',
    detail: 'База на несколько секунд приостановится, кассы автоматически переподключатся.',
    buttons: ['Сделать копию', 'Отмена'],
    defaultId: 0,
    cancelId: 1,
  });
  if (confirm !== 0) return;

  const r = await safeBackupWhileRunning({ note: 'вручную' });
  if (r.ok) {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: 'Резервная копия',
      message: 'Готово.',
      detail: describeBackupResults(r.results),
    });
  } else if (!r.relaunching) {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: 'Резервная копия',
      message: 'Копия сейчас не была создана: ' + (r.reason || 'причина неизвестна'),
    });
  }
}

// Остановить процессы, сделать страховочную копию текущей базы, восстановить из
// выбранной папки и перезапустить приложение. Используется меню (роль main).
async function performRestoreAndRelaunch(backupFolder) {
  shuttingDown = true; // before-quit не должен второй раз останавливать процессы
  try {
    if (webProcess) webProcess.kill();
    if (apiProcess) apiProcess.kill();
    if (pg) {
      try {
        await pg.stop();
      } catch (e) {
        log.error('restore: ошибка остановки Postgres: ' + (e && e.message ? e.message : e));
      }
    }
    // Страховочная копия ТЕКУЩЕЙ базы перед заменой (на случай передумать).
    runBackups({ force: true, note: 'перед восстановлением' });

    const r = backup.restore({
      backupFolder,
      pgDataDir: getPaths().pgData,
      expectPgMajor: PG_MAJOR,
    });
    if (!r.ok) {
      dialog.showErrorBox('Восстановление не удалось', r.reason || 'неизвестная ошибка');
    }
  } catch (err) {
    log.error('restore: ' + (err && err.message ? err.message : err));
    dialog.showErrorBox('Восстановление', 'Ошибка: ' + (err && err.message ? err.message : err));
  } finally {
    // В любом случае перезапускаем: при успехе — на восстановленной базе, при
    // ошибке — возвращаем приложение в рабочее состояние (база не тронута, либо
    // цела страховочная .before-restore).
    app.relaunch();
    app.exit(0);
  }
}

// Интерактивное восстановление (меню роли main): выбрать папку копии → показать
// дату → подтвердить → восстановить.
async function restoreFromBackupInteractive(parentWindow) {
  const ext = getExternalBackupDir();
  const res = await dialog.showOpenDialog(parentWindow || undefined, {
    title: 'Выберите папку резервной копии (pgdata_…)',
    defaultPath: ext || getPaths().backups,
    buttonLabel: 'Восстановить из этой папки',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return;
  const folder = res.filePaths[0];

  if (!backup.looksLikePgdata(folder)) {
    dialog.showErrorBox(
      'Восстановление',
      'Выбранная папка не похожа на резервную копию базы (нет служебных файлов PostgreSQL).\n' +
        'Выберите папку с именем вида pgdata_ГГГГ-ММ-ДД…',
    );
    return;
  }

  const man = backup.readManifest(folder);
  let when = 'неизвестно';
  try {
    if (man && man.createdAt) when = new Date(man.createdAt).toLocaleString('ru-RU');
  } catch {
    /* оставим 'неизвестно' */
  }

  const confirm = dialog.showMessageBoxSync(parentWindow || undefined, {
    type: 'warning',
    title: 'Восстановление базы',
    message: 'Восстановить базу из этой копии?',
    detail:
      `Копия от: ${when}.\n\n` +
      'Текущие данные будут заменены. Прежняя база сохранится рядом как страховка.\n' +
      'Программа перезапустится.',
    buttons: ['Восстановить', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
  });
  if (confirm !== 0) return;

  await performRestoreAndRelaunch(folder);
}

// Разовое предупреждение, если внешняя папка для копий не задана: объясняем
// простыми словами риск переустановки Windows и предлагаем выбрать папку.
function maybeWarnNoExternalBackup(parentWindow) {
  if (getExternalBackupDir()) return; // всё настроено — молчим
  dialog
    .showMessageBox(parentWindow || undefined, {
      type: 'warning',
      title: 'Резервные копии базы',
      message: 'Сейчас копии базы хранятся только на этом компьютере.',
      detail:
        'Если Windows переустановят или диск C выйдет из строя — данные пропадут вместе с копиями.\n\n' +
        'Вставьте флешку (или используйте другой диск, например D:) и укажите папку для копий. ' +
        'Тогда копия базы будет сохраняться и там, и её можно будет восстановить после переустановки.',
      buttons: ['Позже', 'Выбрать папку сейчас'],
      defaultId: 1,
      cancelId: 0,
    })
    .then((r) => {
      if (r.response === 1) pickBackupDir(parentWindow);
    })
    .catch(() => {});
}

// Удаляем временные остатки восстановления/копирования из папки userData, чтобы
// они не копились: `.copying`/`.restoring_` — брошенные на середине; из
// страховочных `.before-restore_` оставляем только самый свежий (одна страховка).
function pruneRestoreLeftovers(paths) {
  try {
    const parent = path.dirname(paths.pgData);
    const entries = fs.readdirSync(parent);
    const beforeRestore = [];
    for (const name of entries) {
      const full = path.join(parent, name);
      if (name.endsWith('.copying') || name.includes('.restoring_')) {
        fs.rmSync(full, { recursive: true, force: true });
        log.info('backup: удалён временный остаток ' + name);
      } else if (name.includes('.before-restore_')) {
        let m = 0;
        try {
          m = fs.statSync(full).mtimeMs;
        } catch {
          /* пропускаем */
        }
        beforeRestore.push({ full, name, m });
      }
    }
    beforeRestore.sort((a, b) => b.m - a.m);
    for (const b of beforeRestore.slice(1)) {
      fs.rmSync(b.full, { recursive: true, force: true });
      log.info('backup: удалена старая страховочная база ' + b.name);
    }
  } catch (err) {
    log.warn('backup: чистка временных остатков не удалась: ' + (err && err.message ? err.message : err));
  }
}

async function startAsMain() {
  const paths = getPaths();
  ensureDirs(paths);

  // 1) Порты свободны? (иначе понятная ошибка вместо тихого полу-запуска)
  await assertPortsFree();
  // 2) Чистим временные остатки прошлых восстановлений/копий.
  pruneRestoreLeftovers(paths);
  // 3) Подстраховочная копия базы ДО старта Postgres (кластер не запущен → копия
  //    консистентна). Не форсируем — throttled раз в сутки, чтобы частые запуски
  //    не плодили копии. Основная копия делается по закрытию смены (см.
  //    'backup:shift-closed'), а «копия сейчас» — кнопкой (с force).
  runBackups({ force: false, note: 'при запуске' });

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

  // Если внешняя папка для копий не задана — один раз мягко предупредим владельца
  // о риске (копии только на диске C пропадут при переустановке Windows).
  maybeWarnNoExternalBackup(mainWindow);
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
  // config: { role: 'main'|'cash', mainHost?: string, cloudSync: boolean, backupDir?: string }
  if (!config || (config.role !== 'main' && config.role !== 'cash')) {
    throw new Error('Некорректная роль ПК');
  }
  store.set('role', config.role);
  store.set('mainHost', config.mainHost || '');
  store.set('cloudSync', !!config.cloudSync);
  // Папку для копий обычно задают отдельной кнопкой (config:pick-backup-dir),
  // но если пришла в конфиге — тоже сохраняем.
  if (typeof config.backupDir === 'string') store.set('backupDir', config.backupDir.trim());
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

// Инфо для экрана настройки: текущая папка копий, найденные диски, флаг «на C:».
ipcMain.handle('config:get-backup-info', () => {
  const dir = String(store.get('backupDir') || '');
  return {
    backupDir: dir,
    drives: detectBackupDrives(),
    onSystemDrive: dir ? isOnSystemDrive(dir) : false,
  };
});

// Кнопка «Выбрать папку…» на экране настройки. Возвращает выбранный путь (или null).
ipcMain.handle('config:pick-backup-dir', async () => {
  const chosen = await pickBackupDir(setupWindow || mainWindow);
  return chosen;
});

// Восстановление при первом запуске (экран настройки): клиент переустановил
// Windows, поставил программу заново и хочет вернуть базу из копии на флешке.
// База ещё не запущена (роль не выбрана) — просто укладываем копию в userData/
// pgdata, делаем этот ПК главным и перезапускаемся.
ipcMain.handle('backup:restore-at-setup', async () => {
  const res = await dialog.showOpenDialog(setupWindow || undefined, {
    title: 'Выберите папку резервной копии (pgdata_…)',
    buttonLabel: 'Восстановить из этой папки',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
  const folder = res.filePaths[0];

  if (!backup.looksLikePgdata(folder)) {
    return { ok: false, reason: 'Выбранная папка не похожа на резервную копию базы.' };
  }

  const paths = getPaths();
  ensureDirs(paths);
  const r = backup.restore({ backupFolder: folder, pgDataDir: paths.pgData, expectPgMajor: PG_MAJOR });
  if (!r.ok) return { ok: false, reason: r.reason };

  // Раз восстанавливаем базу — этот компьютер становится главным.
  store.set('role', 'main');
  if (!store.get('nodeId')) {
    store.set('nodeId', `BOX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
  }
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

// ОСНОВНАЯ резервная копия — по закрытию смены (Z-отчёт). Веб-панель зовёт это
// после успешного закрытия смены (см. preload notifyShiftClosed). Смену закрывают
// раз в день в конце дня → копия примерно раз в день, с полными данными за день,
// независимо от того, сколько раз открывали/закрывали программу.
// Копию делаем с небольшой задержкой, чтобы веб успел обновить экран до
// кратковременной паузы базы; повторные сигналы в пределах зазора игнорируем.
ipcMain.handle('backup:shift-closed', () => {
  if (store.get('role') !== 'main' || !pg) return { ok: false, reason: 'не главный ПК' };
  const now = Date.now();
  if (now - lastShiftBackupAt < SHIFT_BACKUP_MIN_GAP_MS) {
    log.info('backup: сигнал закрытия смены проигнорирован (копия делалась недавно).');
    return { ok: true, skipped: true };
  }
  lastShiftBackupAt = now; // застолбили сразу — дубликаты сигналов в зазоре не сработают
  setTimeout(() => {
    log.info('backup: закрытие смены — делаем резервную копию базы.');
    safeBackupWhileRunning({ note: 'закрытие смены' }).catch((e) =>
      log.error('backup: копия по закрытию смены не удалась: ' + (e && e.message ? e.message : e)),
    );
  }, 4000);
  return { ok: true, scheduled: true };
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
// иначе они останутся «висеть» в фоне после закрытия окна. shuttingDown объявлен
// выше (может быть уже true, если выход инициировали восстановление/копия).
app.on('before-quit', async (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  event.preventDefault();

  log.info('Остановка PrintPro Desktop...');

  if (webProcess) webProcess.kill();
  if (apiProcess) apiProcess.kill();

  if (pg) {
    try {
      await pg.stop();
      log.info('Встроенный Postgres остановлен.');
    } catch (err) {
      log.error('Ошибка остановки Postgres:', err);
    }

    // Postgres остановлен → безопасный момент для копии. Это ПОДСТРАХОВКА
    // (основная копия — по закрытию смены), поэтому throttled: не форсируем, чтобы
    // частое открытие/закрытие программы не плодило копии (не чаще раза в сутки).
    if (store.get('role') === 'main') {
      try {
        runBackups({ force: false, note: 'при выходе' });
      } catch (err) {
        log.error('backup: копия при выходе не удалась: ' + (err && err.message ? err.message : err));
      }
    }
  }

  app.exit(0);
});
