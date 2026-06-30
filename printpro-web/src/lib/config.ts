// Настройки фронтенда PrintPro

// Адрес облачного бэкенда (Render). Используется, когда сайт открыт не на
// localhost и переменная окружения не задана.
const CLOUD_API = 'https://printpro-api.onrender.com/api';
const CLOUD_ORIGIN = 'https://printpro-api.onrender.com';

const LOCAL_API = 'http://localhost:3000/api';
const LOCAL_ORIGIN = 'http://localhost:3000';

/**
 * Выбираем адрес бэкенда автоматически:
 *  1) если задана переменная окружения — берём её (главнее всего);
 *  2) в браузере: localhost → локальный API, иначе → облачный;
 *  3) на сервере (SSR/сборка): production → облачный, иначе → локальный.
 * Так онлайн-сайт сам ходит в облако и не зависит от локального компьютера,
 * а локальная разработка по-прежнему работает с локальным API.
 */
function pick(envVal: string | undefined, cloud: string, local: string): string {
  if (envVal) return envVal;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' ? local : cloud;
  }
  return process.env.NODE_ENV === 'production' ? cloud : local;
}

// Адрес нашего бэкенда (NestJS API)
export const API_BASE = pick(process.env.NEXT_PUBLIC_API_BASE, CLOUD_API, LOCAL_API);

// Корень бэкенда (для прямых ссылок на файлы /uploads/...)
export const SERVER_ORIGIN = pick(
  process.env.NEXT_PUBLIC_SERVER_ORIGIN,
  CLOUD_ORIGIN,
  LOCAL_ORIGIN,
);

// Пока нет выбора компании по поддомену — используем нашу тестовую компанию.
// Позже определим автоматически по адресу (dushanbeprint.printpro.app).
export const DEFAULT_COMPANY_ID =
  process.env.NEXT_PUBLIC_COMPANY_ID ??
  '7628001a-5f9c-45ec-8f6f-a80280d409c5';
