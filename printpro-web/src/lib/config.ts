// Настройки фронтенда PrintPro

// Адрес облачного бэкенда (Render). Используется, когда сайт открыт не на
// localhost и переменная окружения не задана.
const CLOUD_API = 'https://printpro-api.onrender.com/api';
const CLOUD_ORIGIN = 'https://printpro-api.onrender.com';

// Порт локального API (NestJS)
const LOCAL_API_PORT = 3000;

// Локальный компьютер или адрес в локальной сети (LAN):
// localhost, 127.x, 10.x, 192.168.x, 172.16–31.x. Для таких адресов фронт
// ходит в API на ТОМ ЖЕ хосте (чтобы работало и по localhost, и по IP с планшета).
function isLocalHost(h: string | null | undefined): boolean {
  if (!h) return false;
  return (
    h === 'localhost' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/**
 * Выбираем адрес бэкенда автоматически:
 *  1) если задана переменная окружения — берём её (главнее всего);
 *  2) в браузере: localhost или адрес локальной сети → локальный API на том же
 *     хосте (host:3000), иначе → облачный;
 *  3) на сервере (SSR/сборка): production → облачный, иначе → локальный.
 * Так онлайн-сайт сам ходит в облако, а локальная сеть (в т.ч. по IP) — в API
 * на том же компьютере.
 */
function pick(envVal: string | undefined, cloud: string, suffix: string): string {
  if (envVal) return envVal;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (isLocalHost(h)) return `http://${h}:${LOCAL_API_PORT}${suffix}`;
    return cloud;
  }
  return process.env.NODE_ENV === 'production'
    ? cloud
    : `http://localhost:${LOCAL_API_PORT}${suffix}`;
}

// Адрес нашего бэкенда (NestJS API)
export const API_BASE = pick(process.env.NEXT_PUBLIC_API_BASE, CLOUD_API, '/api');

// Корень бэкенда (для прямых ссылок на файлы /uploads/...)
export const SERVER_ORIGIN = pick(
  process.env.NEXT_PUBLIC_SERVER_ORIGIN,
  CLOUD_ORIGIN,
  '',
);

// companyId арендатора.
//  - Облако: фиксированный (env NEXT_PUBLIC_COMPANY_ID или fallback-UUID).
//  - Коробка: у каждого клиента СВОЙ. Фронт узнаёт его в рантайме через
//    /api/system/company-id и кэширует в localStorage. DEFAULT_COMPANY_ID
//    синхронно отдаёт кэш (если уже разрешён), иначе fallback. На сервере
//    (SSR) — всегда fallback.
const FALLBACK_COMPANY_ID =
  process.env.NEXT_PUBLIC_COMPANY_ID ??
  '7628001a-5f9c-45ec-8f6f-a80280d409c5';

export const DEFAULT_COMPANY_ID =
  (typeof window !== 'undefined' &&
    window.localStorage.getItem('companyId')) ||
  FALLBACK_COMPANY_ID;

// Разрешить companyId этой установки в рантайме — вызвать один раз на клиенте
// при старте. Облако: id совпадает с fallback → ничего не меняется. Коробка:
// id отличается → кэшируем и ОДИН раз перезагружаем, чтобы модульная константа
// его подхватила (после перезагрузки id уже в localStorage → совпадёт → без
// повторной перезагрузки). Офлайн/ошибка — остаёмся на текущем companyId.
export async function ensureCompanyIdResolved(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const res = await fetch(`${API_BASE}/system/company-id`);
    if (!res.ok) return;
    const data = (await res.json()) as { companyId?: string | null };
    const id = data?.companyId;
    if (!id) return;
    if (id !== window.localStorage.getItem('companyId')) {
      window.localStorage.setItem('companyId', id);
      if (id !== DEFAULT_COMPANY_ID) window.location.reload();
    }
  } catch {
    // офлайн/ошибка — companyId остаётся текущим (кэш или fallback)
  }
}
