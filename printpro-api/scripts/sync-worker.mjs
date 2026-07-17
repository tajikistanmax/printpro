// Синхронизатор PrintPro — запускается на ЛОКАЛЬНОМ узле (компьютере точки).
// Раз в интервал, если есть интернет, обменивается изменениями с облаком.
//
// Переменные окружения:
//   LOCAL_API     — адрес локального API   (по умолч. http://localhost:3000/api)
//   CLOUD_API     — адрес облачного API     (напр. https://printpro-api.onrender.com/api)
//   SYNC_SECRET   — общий секрет (должен совпадать на обоих узлах)
//   NODE_ID       — короткий код этой точки (напр. K1)
//   SYNC_NODE_SECRET — персональный секрет узла для HMAC+nonce (рекомендуется)
//   SYNC_INTERVAL — период в секундах (по умолч. 20)
//
// Запуск:  node scripts/sync-worker.mjs
// Переменные можно положить в printpro-api/.env — они подхватятся автоматически
// (консольные переменные имеют приоритет над .env).

import 'dotenv/config';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const LOCAL = process.env.LOCAL_API ?? 'http://localhost:3000/api';
const CLOUD = process.env.CLOUD_API;
const SECRET = process.env.SYNC_SECRET;
const NODE_ID = (process.env.NODE_ID ?? 'K1').toUpperCase();
const NODE_SECRET = process.env.SYNC_NODE_SECRET;
const INTERVAL = (Number(process.env.SYNC_INTERVAL) || 20) * 1000;
const STATE_DIR = process.env.SYNC_STATE_DIR ?? process.cwd();
const STATE_FILE = join(STATE_DIR, '.sync-state.json');

if (!CLOUD || !SECRET) {
  console.error('Нужны переменные CLOUD_API и SYNC_SECRET');
  process.exit(1);
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return { cloudPull: '1970-01-01T00:00:00.000Z', localPull: '1970-01-01T00:00:00.000Z' };
  }
}
async function saveState(s) {
  // Не оставляем обрезанный JSON при аварийном завершении во время записи.
  const tmp = `${STATE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, STATE_FILE);
}

async function call(base, path, body) {
  const bodyText = JSON.stringify(body ?? {});
  const headers = { 'Content-Type': 'application/json', 'x-sync-secret': SECRET };
  if (NODE_SECRET) {
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const bodyHash = createHash('sha256').update(bodyText).digest('hex');
    headers['x-sync-node'] = NODE_ID;
    headers['x-sync-timestamp'] = timestamp;
    headers['x-sync-nonce'] = nonce;
    headers['x-sync-signature'] = createHmac('sha256', NODE_SECRET)
      .update(`${NODE_ID}.${timestamp}.${nonce}.${bodyHash}`)
      .digest('hex');
  }
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: bodyText,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function count(changes) {
  return Object.values(changes ?? {}).reduce((s, a) => s + a.length, 0);
}

// Перекрытие защищает от строки, updatedAt которой выставлен до server `until`,
// но транзакция закоммичена уже после ответа pull. Повтор безопасен благодаря LWW.
const OVERLAP_MS = 5 * 60 * 1000;
function overlappedSince(cursor) {
  const time = new Date(cursor).getTime();
  if (!Number.isFinite(time)) throw new Error('сервер вернул некорректный sync cursor');
  return new Date(Math.max(0, time - OVERLAP_MS)).toISOString();
}

function serverCursor(until) {
  const time = new Date(until).getTime();
  if (!Number.isFinite(time)) throw new Error('сервер вернул некорректный sync cursor');
  return new Date(time).toISOString();
}

async function cycle(state) {
  // 1) Облако → Локал
  const fromCloud = await call(CLOUD, '/sync/pull', {
    since: overlappedSince(state.cloudPull),
  });
  let cloudFailed = 0;
  if (count(fromCloud.changes) > 0) {
    const r = await call(LOCAL, '/sync/push', {
      changes: fromCloud.changes,
      peer: 'CLOUD',
    });
    cloudFailed = Number(r.failed ?? 0);
    console.log(
      `↓ из облака: применено ${r.applied}, пропущено ${r.skipped}, ошибок ${cloudFailed}`,
    );
  }
  // Если хотя бы одна строка не применилась, курсор не двигаем: следующая
  // попытка перечитает окно, иначе эта строка потерялась бы навсегда.
  // Храним настоящий server cursor. Перекрытие применяем только к следующему
  // запросу, иначе курсор откатывался бы ещё на 5 минут в каждом цикле.
  if (cloudFailed === 0) state.cloudPull = serverCursor(fromCloud.until);

  // 2) Локал → Облако
  const fromLocal = await call(LOCAL, '/sync/pull', {
    since: overlappedSince(state.localPull),
  });
  let localFailed = 0;
  if (count(fromLocal.changes) > 0) {
    const r = await call(CLOUD, '/sync/push', {
      changes: fromLocal.changes,
      peer: NODE_ID,
    });
    localFailed = Number(r.failed ?? 0);
    console.log(
      `↑ в облако: применено ${r.applied}, пропущено ${r.skipped}, ошибок ${localFailed}`,
    );
  }
  if (localFailed === 0) state.localPull = serverCursor(fromLocal.until);

  await saveState(state);

  // Отметка успешной синхронизации (для индикатора в панели)
  try {
    await call(LOCAL, '/sync/heartbeat', {});
  } catch {
    // не критично
  }
}

async function main() {
  console.log(`Синхронизатор запущен. Узел=${NODE_ID}, интервал=${INTERVAL / 1000}с`);
  const state = await loadState();
  for (;;) {
    try {
      await cycle(state);
    } catch (e) {
      // Нет интернета или облако недоступно — попробуем в следующий раз
      console.log(`⏳ синхронизация отложена: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main();
