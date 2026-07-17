// PrintPro — HEADLESS-СЕРВЕР (Уровень 2: сервер как служба Windows).
//
// Этот файл запускается как ОБЫЧНЫЙ Node (через ELECTRON_RUN_AS_NODE=1 у
// бинарника PrintPro.exe — так не нужен отдельный node.exe). Никаких окон,
// Chromium и Electron-API здесь НЕТ — поэтому его можно надёжно запускать как
// службу Windows в сессии 0 (где обычный Electron с окном падает).
//
// Что делает: поднимает встроенный Postgres, применяет миграции, seed, запускает
// printpro-api и printpro-web как дочерние процессы, делает резервные копии,
// корректно останавливается по сигналу службы. Живёт, пока жива служба —
// НЕЗАВИСИМО от того, открыто ли окно PrintPro и залогинен ли кто-то.
//
// Окно PrintPro (main.js, роль "main") при живой службе НЕ поднимает свой сервер,
// а просто открывается на http://localhost:3001 (как касса, только локально).
//
// ВАЖНО: сервер-логика здесь СОЗНАТЕЛЬНО отделена от main.js (а не вынесена в
// общий модуль), чтобы не задеть уже отлаженный «встроенный» путь запуска
// (там были выстраданы 3 рантайм-бага: ESM-импорт, asar, кодировка). Общими
// остаются только пути к данным (data-paths.js) и модуль копий (backup.js).

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const log = require('electron-log');

const dataPaths = require('./data-paths');
const backup = require('./backup');

// ── Константы (совпадают с main.js — служба и окно используют одни порты) ──────
const API_PORT = 3000;
const WEB_PORT = 3001;
const PG_PORT = 5433;
const CONTROL_PORT = 3002; // локальный управляющий эндпоинт службы (только 127.0.0.1)
const PG_USER = 'postgres';
const PG_PASSWORD = 'printpro_local';
const PG_DATABASE = 'printpro';
const LOCAL_KEEP = 5;
const EXTERNAL_KEEP = 10;
const BACKUP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // подстраховочная копия — не чаще раза в сутки

// ── Пути к данным (ProgramData) и к ресурсам (установленная программа) ─────────
const paths = dataPaths.ensureDataDirs();

// Логи службы — в общесистемную папку логов (не в профиль SYSTEM).
log.transports.file.level = 'info';
log.transports.file.resolvePathFn = () => path.join(paths.logs, 'server.log');
log.transports.console.level = 'debug';
Object.assign(console, log.functions);

// Ресурсы (printpro-api/dist, printpro-web, prisma) лежат в resources/ рядом с
// exe. В службе process.resourcesPath может быть не задан → берём из env,
// который проставляет служба (PRINTPRO_RESOURCES), с запасным вариантом.
function getResourcesRoot() {
  if (process.env.PRINTPRO_RESOURCES) return process.env.PRINTPRO_RESOURCES;
  if (process.resourcesPath) return process.resourcesPath;
  // Дев-запуск из папки electron/ (npm-скрипт) — берём соседние папки монорепо.
  return path.join(__dirname, '..');
}

const RES = getResourcesRoot();
const apiDir = path.join(RES, 'printpro-api');
// webDir: в упакованном виде server.js лежит прямо в RES/printpro-web; в дев-
// запуске из монорепо — в .next/standalone. Определяем ПРОБОЙ (по наличию
// server.js), а не по флагу — надёжнее и для сборки, и для ручного теста.
const webDir = fs.existsSync(path.join(RES, 'printpro-web', 'server.js'))
  ? path.join(RES, 'printpro-web')
  : path.join(RES, 'printpro-web', '.next', 'standalone');

// ── Состояние ─────────────────────────────────────────────────────────────────
let pg = null;
let apiProcess = null;
let webProcess = null;
let shuttingDown = false;
let backupInProgress = false;

// ── Конфиг (общий JSON с окном; окно пишет его через electron-store) ──────────
function getConfig() {
  return dataPaths.readConfig();
}

// JWT-секрет обязателен для printpro-api в production. Обычно его создаёт окно
// (main.js) при первом запуске, но если служба стартовала РАНЬШЕ окна (после
// перезагрузки ПК) — создаём и сохраняем здесь, чтобы токены были стабильны.
function getOrCreateJwtSecret() {
  const cfg = getConfig();
  if (cfg.jwtSecret) return cfg.jwtSecret;
  cfg.jwtSecret = crypto.randomBytes(48).toString('hex');
  dataPaths.writeConfig(cfg);
  log.info('server: сгенерирован новый JWT_SECRET (первый запуск службы до окна).');
  return cfg.jwtSecret;
}

// ── Мелкие помощники (портированы из main.js без Electron-зависимостей) ────────
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Таймаут (${Math.round(ms / 1000)}с): ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function waitForHttpOk(url, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve(true);
        else if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, intervalMs);
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

function isPortFree(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    if (host) srv.listen(port, host);
    else srv.listen(port);
  });
}

async function assertPortsFree() {
  const checks = [
    { port: PG_PORT, host: '127.0.0.1', what: 'встроенная база данных' },
    { port: API_PORT, host: null, what: 'API-сервер' },
    { port: WEB_PORT, host: null, what: 'веб-панель' },
  ];
  const busy = [];
  for (const c of checks) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await isPortFree(c.port, c.host))) busy.push(`порт ${c.port} — ${c.what}`);
  }
  if (busy.length) {
    throw new Error('Порты заняты другой программой:\n  ' + busy.join('\n  '));
  }
}

function spawnNode(scriptPath, args, options) {
  const child = spawn(process.execPath, [scriptPath, ...(args || [])], {
    ...options,
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

// ── Встроенный Postgres (ESM-only → динамический import, кодировка UTF8) ───────
async function ensureEmbeddedPostgres() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  pg = new EmbeddedPostgres({
    databaseDir: paths.pgData,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
    // Кодировка строго UTF8 (иначе миграции с Unicode падают на русской Windows),
    // locale=C — независимость от локали машины. Та же настройка, что в main.js.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: (msg) => log.info('[postgres]', msg),
    onError: (err) => log.error('[postgres]', err && err.message ? err.message : err),
  });

  const firstRun = !fs.existsSync(path.join(paths.pgData, 'PG_VERSION'));
  if (firstRun) {
    log.info('server: первый запуск Postgres — initdb...');
    await withTimeout(pg.initialise(), 120000, 'инициализация Postgres (initdb)');
  }
  await withTimeout(pg.start(), 60000, 'запуск Postgres');
  log.info(`server: Postgres запущен на ${PG_PORT}`);

  try {
    await pg.createDatabase(PG_DATABASE);
  } catch (err) {
    log.debug('createDatabase:', err && err.message ? err.message : err);
  }
  return `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DATABASE}?schema=public`;
}

function runPrismaMigrateDeploy(databaseUrl) {
  return new Promise((resolve) => {
    const prismaCli = path.join(apiDir, 'node_modules', 'prisma', 'build', 'index.js');
    const schemaPath = path.join(apiDir, 'prisma', 'schema.prisma');
    if (!fs.existsSync(prismaCli)) {
      log.error('server: prisma CLI не найден:', prismaCli, '— миграции пропущены.');
      resolve(false);
      return;
    }
    const child = spawnNode(prismaCli, ['migrate', 'deploy', '--schema', schemaPath], {
      cwd: apiDir,
      env: { DATABASE_URL: databaseUrl },
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

function runSeed(databaseUrl) {
  return new Promise((resolve) => {
    const seedScript = path.join(apiDir, 'dist', 'bootstrap', 'seed.js');
    if (!fs.existsSync(seedScript)) {
      log.warn('server: dist/bootstrap/seed.js не найден — компания/админ не создадутся.');
      resolve(false);
      return;
    }
    const child = spawnNode(seedScript, [], {
      cwd: apiDir,
      env: { DATABASE_URL: databaseUrl, BOX_MODE: '1' },
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

function startApiProcess(databaseUrl) {
  const cfg = getConfig();
  const mainScript = path.join(apiDir, 'dist', 'main.js');
  apiProcess = spawnNode(mainScript, [], {
    cwd: apiDir,
    env: {
      DATABASE_URL: databaseUrl,
      PORT: String(API_PORT),
      NODE_ENV: 'production',
      JWT_SECRET: getOrCreateJwtSecret(),
      UPLOADS_DIR: paths.uploads,
      NODE_ID: cfg.nodeId || 'BOX',
      ALLOW_LAN_ORIGINS: '1',
    },
  });
}

function startWebProcess() {
  const serverScript = path.join(webDir, 'server.js');
  webProcess = spawnNode(serverScript, [], {
    cwd: webDir,
    env: { PORT: String(WEB_PORT), HOSTNAME: '0.0.0.0', NODE_ENV: 'production' },
  });
}

// ── Резервные копии (служба владеет базой → копии делает она) ──────────────────
function getExternalBackupDir() {
  const d = String(getConfig().backupDir || '').trim();
  if (!d) return '';
  try {
    fs.mkdirSync(d, { recursive: true });
    return d;
  } catch (err) {
    log.warn('backup: внешняя папка недоступна (' + d + '):', err && err.message ? err.message : err);
    return '';
  }
}

// Копии базы. ВЫЗЫВАТЬ только когда Postgres ОСТАНОВЛЕН (копия консистентна).
function runBackups({ force = false, note } = {}) {
  const appVersion = String(getConfig().appVersion || '');
  const minInterval = force ? 0 : BACKUP_MIN_INTERVAL_MS;
  const results = [];
  results.push({
    where: 'на этом компьютере',
    ...backup.coldCopy({
      pgDataDir: paths.pgData, destRoot: paths.backups, keep: LOCAL_KEEP,
      minIntervalMs: minInterval, force, appVersion, note,
    }),
  });
  const ext = getExternalBackupDir();
  if (ext) {
    results.push({
      where: 'на внешнем носителе',
      ...backup.coldCopy({
        pgDataDir: paths.pgData, destRoot: ext, keep: EXTERNAL_KEEP,
        minIntervalMs: minInterval, force, appVersion, note,
      }),
    });
  }
  for (const r of results) {
    if (r.ok && !r.skipped) log.info(`backup: копия ${r.where} готова → ${r.dest}`);
    else if (r.skipped) log.info(`backup: копия ${r.where} пропущена (${r.reason || ''})`);
    else log.warn(`backup: копия ${r.where} НЕ создана: ${r.reason || 'ошибка'}`);
  }
  return results;
}

// Копия при РАБОТАЮЩЕЙ базе: коротко останавливаем Postgres, копируем, снова
// поднимаем. Две сразу не запускаем. Используется управляющим эндпоинтом
// (кнопка «копия сейчас» и сигнал закрытия смены из окна).
async function safeBackupWhileRunning({ note } = {}) {
  if (!pg) return { ok: false, reason: 'база не запущена' };
  if (backupInProgress) return { ok: false, reason: 'копия уже выполняется' };
  backupInProgress = true;
  try {
    await pg.stop();
    const results = runBackups({ force: true, note });
    await pg.start();
    return { ok: true, results };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    log.error('safeBackup: не удалось (' + msg + ')');
    // База могла остаться остановленной — пробуем поднять снова.
    try { await pg.start(); } catch (e2) { log.error('safeBackup: повторный запуск базы не удался:', e2 && e2.message); }
    return { ok: false, reason: msg };
  } finally {
    backupInProgress = false;
  }
}

// ── Управляющий эндпоинт службы (только 127.0.0.1) ────────────────────────────
// Окно (main.js) дергает его для: проверки живости, копии по кнопке, копии по
// закрытию смены. Наружу (в LAN) НЕ смотрит — слушает только loopback.
function startControlServer() {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/control/ping') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'printpro', pg: !!pg }));
      return;
    }
    if (url === '/control/backup-now' && req.method === 'POST') {
      safeBackupWhileRunning({ note: 'по запросу окна' })
        .then((r) => {
          res.writeHead(r.ok ? 200 : 409, { 'content-type': 'application/json' });
          res.end(JSON.stringify(r));
        })
        .catch((e) => {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: String(e && e.message ? e.message : e) }));
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('error', (err) => log.error('control: ошибка управляющего сервера:', err && err.message));
  server.listen(CONTROL_PORT, '127.0.0.1', () => log.info(`control: слушаю 127.0.0.1:${CONTROL_PORT}`));
  return server;
}

// ── Жизненный цикл службы ─────────────────────────────────────────────────────
async function start() {
  log.info('════ PrintPro server-host запускается ════');
  log.info('server: данные =', paths.root);
  log.info('server: ресурсы =', RES);

  await assertPortsFree();

  // Подстраховочная копия ДО старта Postgres (кластер не запущен → консистентна),
  // throttled (не чаще раза в сутки).
  try { runBackups({ force: false, note: 'при запуске службы' }); }
  catch (e) { log.error('backup: копия при запуске не удалась:', e && e.message); }

  const databaseUrl = await ensureEmbeddedPostgres();
  await runPrismaMigrateDeploy(databaseUrl);
  await runSeed(databaseUrl);

  startApiProcess(databaseUrl);
  const apiReady = await waitForHttpOk(`http://127.0.0.1:${API_PORT}/api/health`, { timeoutMs: 30000 });
  if (!apiReady) log.warn('server: API не ответил на /api/health за 30с (продолжаем).');

  startWebProcess();
  await waitForHttpOk(`http://127.0.0.1:${WEB_PORT}`, { timeoutMs: 30000 });

  startControlServer();
  log.info('════ PrintPro server-host готов (кассы могут подключаться) ════');
}

async function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('server: остановка по сигналу службы...');
  try { if (webProcess) webProcess.kill(); } catch { /* ignore */ }
  try { if (apiProcess) apiProcess.kill(); } catch { /* ignore */ }
  if (pg) {
    try {
      await pg.stop();
      log.info('server: Postgres остановлен.');
      // Копия при остановке (throttled) — база уже стоит, момент консистентный.
      try { runBackups({ force: false, note: 'при остановке службы' }); }
      catch (e) { log.error('backup: копия при остановке не удалась:', e && e.message); }
    } catch (err) {
      log.error('server: ошибка остановки Postgres:', err && err.message ? err.message : err);
    }
  }
  process.exit(0);
}

// Служба останавливается сигналами (WinSW/SCM шлёт CTRL_C/CTRL_BREAK → SIGINT/
// SIGBREAK на Windows; на всякий случай ловим и SIGTERM, и сообщение 'shutdown').
for (const sig of ['SIGINT', 'SIGBREAK', 'SIGTERM', 'SIGHUP']) {
  try { process.on(sig, () => { stop(); }); } catch { /* сигнал недоступен на платформе */ }
}
process.on('message', (m) => { if (m === 'shutdown') stop(); });

process.on('uncaughtException', (err) => {
  log.error('server: необработанная ошибка:', err && err.stack ? err.stack : err);
});

start().catch((err) => {
  log.error('server: КРИТИЧЕСКАЯ ошибка запуска:', err && err.stack ? err.stack : err);
  process.exit(1);
});
