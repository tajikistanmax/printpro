// PrintPro Desktop — плановый локальный бэкап встроенной базы.
//
// ЗАГЛУШКА-МОДУЛЬ (Фаза 1 — скелет): структура и API готовы, но реальный
// путь до бинарника pg_dump зависит от того, как именно пакет
// embedded-postgres распаковывает платформенные бинарники Postgres — это
// нужно уточнить при первой реальной сборке (см. TODO(build) ниже).
//
// Идея: раз в N часов делаем `pg_dump` встроенной базы в файл
// <userData>/backups/printpro-YYYY-MM-DD_HH-mm-ss.sql, храним только
// последние `keep` файлов (ротация). Это ЛОКАЛЬНАЯ страховка на случай
// падения диска/базы — не заменяет облачную синхронизацию (Фаза 3).
//
// TODO: облачная выгрузка бэкапа (не только локальный файл) — по желанию
// владельца, когда будет готова синхронизация с облаком.

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');

// Формируем имя файла бэкапа с меткой времени, безопасное для имени файла
// на Windows (без двоеточий).
function backupFileName() {
  const now = new Date();
  const stamp = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
  return `printpro-${stamp}.sql`;
}

// Запускает pg_dump один раз. ctx = { pgBinDir, databaseUrl, backupsDir, keep }.
function runBackupOnce(ctx) {
  return new Promise((resolve) => {
    if (!ctx || !ctx.backupsDir) {
      log.warn('backup.js: нет backupsDir — бэкап пропущен.');
      resolve(false);
      return;
    }

    fs.mkdirSync(ctx.backupsDir, { recursive: true });

    // TODO(build): уточнить реальное имя бинарника (pg_dump / pg_dump.exe на
    // Windows) и папку, куда embedded-postgres кладёт распакованные
    // бинарники Postgres (обычно рядом с databaseDir или в кэше пакета —
    // см. документацию embedded-postgres на момент сборки). Если ctx.pgBinDir
    // не задан/неверен — просто логируем и выходим, не роняя приложение.
    const pgDumpBin = ctx.pgBinDir
      ? path.join(ctx.pgBinDir, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump')
      : null;

    if (!pgDumpBin || !fs.existsSync(pgDumpBin)) {
      log.warn(
        'backup.js: pg_dump не найден по ожидаемому пути (%s) — бэкап пропущен. ' +
          'Это ожидаемо для скелета Фазы 1, доработать при реальной сборке.',
        pgDumpBin,
      );
      resolve(false);
      return;
    }

    const outFile = path.join(ctx.backupsDir, backupFileName());
    const out = fs.createWriteStream(outFile);
    const child = spawn(pgDumpBin, ['--dbname', ctx.databaseUrl, '--format', 'plain'], {
      windowsHide: true,
    });

    child.stdout.pipe(out);
    child.stderr.on('data', (d) => log.error('[pg_dump]', d.toString().trim()));

    child.on('error', (err) => {
      log.error('backup.js: не удалось запустить pg_dump:', err.message);
      resolve(false);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        log.info('backup.js: резервная копия создана:', outFile);
        rotateBackups(ctx.backupsDir, ctx.keep || 14);
        resolve(true);
      } else {
        log.error('backup.js: pg_dump завершился с кодом', code);
        resolve(false);
      }
    });
  });
}

// Оставляем только `keep` самых свежих файлов бэкапа, старые удаляем.
function rotateBackups(backupsDir, keep) {
  try {
    const files = fs
      .readdirSync(backupsDir)
      .filter((f) => f.startsWith('printpro-') && f.endsWith('.sql'))
      .map((f) => ({ f, mtime: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const { f } of files.slice(keep)) {
      fs.unlinkSync(path.join(backupsDir, f));
      log.info('backup.js: удалён старый бэкап:', f);
    }
  } catch (err) {
    log.error('backup.js: ошибка ротации бэкапов:', err.message);
  }
}

// Планирует регулярный бэкап через setInterval. Возвращает timer (для
// clearInterval при выходе из приложения). Не запускает бэкап немедленно —
// первый сработает через intervalMs (можно вызвать runBackupOnce(ctx)
// сразу после старта, если нужен бэкап «сразу же»).
function schedulePgDumpBackups(ctx, intervalMs) {
  return setInterval(() => {
    runBackupOnce(ctx).catch((err) => log.error('backup.js: ошибка планового бэкапа:', err));
  }, intervalMs);
}

module.exports = { runBackupOnce, schedulePgDumpBackups, rotateBackups };
