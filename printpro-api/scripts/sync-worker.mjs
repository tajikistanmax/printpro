// Синхронизатор PrintPro — запускается на ЛОКАЛЬНОМ узле (компьютере точки).
// Раз в интервал, если есть интернет, обменивается изменениями с облаком.
//
// Переменные окружения:
//   LOCAL_API     — адрес локального API   (по умолч. http://localhost:3000/api)
//   CLOUD_API     — адрес облачного API     (напр. https://printpro-api.onrender.com/api)
//   SYNC_SECRET   — общий секрет (должен совпадать на обоих узлах)
//   NODE_ID       — короткий код этой точки (напр. K1)
//   SYNC_INTERVAL — период в секундах (по умолч. 20)
//
// Запуск:  node scripts/sync-worker.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOCAL = process.env.LOCAL_API ?? 'http://localhost:3000/api';
const CLOUD = process.env.CLOUD_API;
const SECRET = process.env.SYNC_SECRET;
const NODE_ID = (process.env.NODE_ID ?? 'K1').toUpperCase();
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
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

async function call(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-secret': SECRET },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function count(changes) {
  return Object.values(changes ?? {}).reduce((s, a) => s + a.length, 0);
}

async function cycle(state) {
  // 1) Облако → Локал
  const fromCloud = await call(CLOUD, '/sync/pull', { since: state.cloudPull });
  if (count(fromCloud.changes) > 0) {
    const r = await call(LOCAL, '/sync/push', {
      changes: fromCloud.changes,
      peer: 'CLOUD',
    });
    console.log(`↓ из облака: применено ${r.applied}, пропущено ${r.skipped}`);
  }
  state.cloudPull = fromCloud.until;

  // 2) Локал → Облако
  const fromLocal = await call(LOCAL, '/sync/pull', { since: state.localPull });
  if (count(fromLocal.changes) > 0) {
    const r = await call(CLOUD, '/sync/push', {
      changes: fromLocal.changes,
      peer: NODE_ID,
    });
    console.log(`↑ в облако: применено ${r.applied}, пропущено ${r.skipped}`);
  }
  state.localPull = fromLocal.until;

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
