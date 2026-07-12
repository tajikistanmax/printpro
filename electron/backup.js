// PrintPro Desktop — локальные резервные копии встроенной базы (без pg_dump).
//
// ПОЧЕМУ НЕ pg_dump. Пакет embedded-postgres (windows-x64) кладёт только
// СЕРВЕРНЫЕ бинарники (initdb.exe/pg_ctl.exe/postgres.exe). Клиентских утилит
// (pg_dump.exe/pg_restore.exe/psql.exe) в комплекте НЕТ (сверено на реальной
// установке — в native/bin их нет, есть только .mo-переводы). Докладывать их из
// полной сборки Postgres = лишний вес + риск для офлайн-сборки. Поэтому копия —
// это «холодная копия» папки данных Postgres (pgData): её делают, когда сервер
// ОСТАНОВЛЕН, тогда копия консистентна и восстанавливается простой подменой
// папки. В рамках одной и той же версии программы (тот же Postgres 17) это
// восстановление на 100% надёжно.
//
// ГЛАВНОЕ ПРО МЕСТО ХРАНЕНИЯ. Копии складываются НЕ только рядом с базой (диск C,
// профиль приложения), но и в папку, которую владелец указал в настройке
// (флешка / внешний диск / диск D). Это защищает от переустановки Windows: диск
// C форматируется вместе с базой И локальными копиями — уцелеет только копия,
// лежащая на другом носителе. См. main.js (runBackups / restore*).

'use strict';

const fs = require('fs');
const path = require('path');
const log = require('electron-log');

// Метка времени, безопасная для имени файла на Windows (без двоеточий).
function stamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
}

// Префикс папок-копий и имя файла-манифеста внутри копии.
const BACKUP_PREFIX = 'pgdata_';
const MANIFEST_NAME = 'printpro-backup.json';

// Мажорная версия Postgres из служебного файла PG_VERSION (например "17").
// Это источник правды: восстанавливать копию можно только в кластер той же
// мажорной версии (иначе формат файлов несовместим).
function readPgMajor(pgDataDir) {
  try {
    const v = fs.readFileSync(path.join(pgDataDir, 'PG_VERSION'), 'utf8').trim();
    return v || null;
  } catch {
    return null;
  }
}

// Похоже ли содержимое папки на копию/кластер Postgres (есть PG_VERSION).
function looksLikePgdata(dir) {
  try {
    return fs.existsSync(path.join(dir, 'PG_VERSION'));
  } catch {
    return false;
  }
}

// Манифест копии — маленький JSON рядом с данными: что это, какой версией
// программы и какого Postgres сделано, когда. По нему восстановление понимает,
// совместима ли копия, и показывает человеку понятную дату.
function writeManifest(destFolder, { pgMajor, appVersion, note }) {
  const manifest = {
    app: 'PrintPro',
    kind: 'pgdata-cold-copy',
    pgMajor: pgMajor || null,
    appVersion: appVersion || null,
    createdAt: new Date().toISOString(),
    note: note || null,
  };
  try {
    fs.writeFileSync(
      path.join(destFolder, MANIFEST_NAME),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
  } catch (err) {
    log.warn('backup: не удалось записать манифест копии: ' + (err && err.message ? err.message : err));
  }
  return manifest;
}

function readManifest(folder) {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, MANIFEST_NAME), 'utf8'));
  } catch {
    return null;
  }
}

// Список копий в одной папке (только наши pgdata_*), свежие первыми.
function listBackupsIn(root) {
  try {
    if (!root || !fs.existsSync(root)) return [];
    return fs
      .readdirSync(root)
      .filter((f) => f.startsWith(BACKUP_PREFIX))
      .map((f) => {
        const full = path.join(root, f);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          /* пропускаем недоступную */
        }
        return { name: f, path: full, root, mtime, manifest: readManifest(full) };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (err) {
    log.warn('backup: не удалось прочитать папку копий ' + root + ': ' + (err && err.message ? err.message : err));
    return [];
  }
}

// Ротация: оставляем `keep` самых свежих копий, старые удаляем.
function rotate(root, keep) {
  try {
    for (const b of listBackupsIn(root).slice(Math.max(0, keep))) {
      fs.rmSync(b.path, { recursive: true, force: true });
      log.info('backup: удалена старая копия ' + b.name);
    }
  } catch (err) {
    log.warn('backup: ошибка ротации в ' + root + ': ' + (err && err.message ? err.message : err));
  }
}

// Одна холодная копия pgData → root/pgdata_<время>.
// ВАЖНО: вызывать только когда Postgres ОСТАНОВЛЕН (иначе копия может оказаться
// несогласованной). Возвращает { ok, skipped, dest, reason }.
//   - minIntervalMs: не копировать, если в root уже есть копия свежее этого
//     интервала (чтобы не писать на флешку при каждом запуске). force=true
//     игнорирует интервал (для копии «сейчас» и копии при выходе).
function coldCopy({ pgDataDir, destRoot, keep = 10, minIntervalMs = 0, force = false, appVersion, note }) {
  try {
    if (!pgDataDir || !looksLikePgdata(pgDataDir)) {
      return { ok: false, skipped: true, reason: 'база ещё не инициализирована' };
    }
    if (!destRoot) {
      return { ok: false, skipped: true, reason: 'не задана папка назначения' };
    }
    fs.mkdirSync(destRoot, { recursive: true });

    if (!force && minIntervalMs > 0) {
      const existing = listBackupsIn(destRoot);
      if (existing.length && Date.now() - existing[0].mtime < minIntervalMs) {
        return { ok: true, skipped: true, reason: 'свежая копия уже есть', dest: existing[0].path };
      }
    }

    const dest = path.join(destRoot, BACKUP_PREFIX + stamp());
    // Копируем во временную папку и лишь потом переименовываем — чтобы прерванная
    // на середине копия не выглядела как «готовая» (частичная папка pgdata_*).
    const tmp = dest + '.copying';
    fs.rmSync(tmp, { recursive: true, force: true });
    log.info('backup: холодная копия pgdata → ' + dest);
    fs.cpSync(pgDataDir, tmp, { recursive: true });
    writeManifest(tmp, { pgMajor: readPgMajor(pgDataDir), appVersion, note });
    fs.renameSync(tmp, dest);
    log.info('backup: копия готова (' + dest + ')');

    rotate(destRoot, keep);
    return { ok: true, skipped: false, dest };
  } catch (err) {
    // Бэкап не должен ронять приложение.
    log.error('backup: холодная копия не удалась: ' + (err && err.message ? err.message : err));
    return { ok: false, skipped: false, reason: err && err.message ? err.message : String(err) };
  }
}

// Восстановление: заменить содержимое pgDataDir содержимым backupFolder.
// ВАЖНО: вызывать только когда Postgres ОСТАНОВЛЕН. Текущую базу не удаляем
// сразу — сдвигаем в сторону (pgdata.before-restore_<время>) как страховку, и
// удаляем лишь после успешной укладки новой. Проверяем совместимость версии
// Postgres (мажор из PG_VERSION), иначе отказываемся с понятной причиной.
// Возвращает { ok, reason, safetyCopy }.
function restore({ backupFolder, pgDataDir, expectPgMajor }) {
  try {
    if (!backupFolder || !looksLikePgdata(backupFolder)) {
      return { ok: false, reason: 'выбранная папка не похожа на резервную копию базы' };
    }
    const backupMajor = readPgMajor(backupFolder);
    if (expectPgMajor && backupMajor && String(backupMajor) !== String(expectPgMajor)) {
      return {
        ok: false,
        reason:
          'копия сделана другой версией базы (Postgres ' +
          backupMajor +
          '), а программа использует Postgres ' +
          expectPgMajor +
          '. Прямое восстановление невозможно — нужна та же версия программы.',
      };
    }

    const parent = path.dirname(pgDataDir);
    fs.mkdirSync(parent, { recursive: true });

    // 1) Кладём копию рядом во временную папку (не трогая текущую базу).
    const staged = pgDataDir + '.restoring_' + stamp();
    fs.rmSync(staged, { recursive: true, force: true });
    fs.cpSync(backupFolder, staged, { recursive: true });
    // Манифест из копии в рабочей базе не нужен — он остаётся в самой копии.
    fs.rmSync(path.join(staged, MANIFEST_NAME), { force: true });

    // 2) Сдвигаем текущую базу в сторону (если она есть) — страховка на случай,
    //    если что-то пойдёт не так. На Windows переименование может не сразу
    //    отпустить блокировки — пробуем несколько раз.
    let safetyCopy = null;
    if (fs.existsSync(pgDataDir)) {
      safetyCopy = pgDataDir + '.before-restore_' + stamp();
      renameWithRetry(pgDataDir, safetyCopy);
    }

    // 3) Ставим восстановленную базу на место рабочей.
    renameWithRetry(staged, pgDataDir);
    log.info('backup: база восстановлена из ' + backupFolder + (safetyCopy ? ' (прежняя → ' + safetyCopy + ')' : ''));
    return { ok: true, safetyCopy };
  } catch (err) {
    log.error('backup: восстановление не удалось: ' + (err && err.message ? err.message : err));
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

// Переименование с несколькими попытками — на Windows файловые блокировки
// (антивирус/индексатор/только что остановленный postgres) могут отпуститься
// не мгновенно.
function renameWithRetry(from, to, attempts = 10) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      lastErr = err;
      // Небольшая синхронная пауза без внешних зависимостей.
      const until = Date.now() + 300;
      while (Date.now() < until) {
        /* busy-wait 300мс */
      }
    }
  }
  throw lastErr || new Error('renameSync не удался: ' + from + ' → ' + to);
}

module.exports = {
  BACKUP_PREFIX,
  MANIFEST_NAME,
  coldCopy,
  restore,
  rotate,
  listBackupsIn,
  readManifest,
  readPgMajor,
  looksLikePgdata,
};
