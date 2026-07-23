'use client';

import { api } from './api';
import { isFeatureEnabledCached } from './feature-flags';

/**
 * Дисплей покупателя (второй экран).
 *
 * Локальный монитор: касса вещает состояние корзины через BroadcastChannel, а
 * окно /customer-display на ТОМ ЖЕ ПК слушает его. Оба окна на одном origin —
 * никакого сервера не нужно, всё в браузере.
 *
 * Отдельный компьютер (по сети): дополнительно касса публикует то же состояние
 * в релей на сервере (POST /display/state), а второй экран на другом ПК
 * опрашивает его (GET /display/state) — см. subscribeDisplayNetwork ниже.
 */

export const DISPLAY_CHANNEL = 'printpro-customer-display';

// Ключ дисплея по умолчанию (одна касса → один экран). Совпадает с дефолтом на
// бэкенде; вынесен для сетевого транспорта и построения ссылки сопряжения.
export const DISPLAY_KEY_DEFAULT = '1';

export type DisplayLine = {
  name: string;
  qty: number;
  price: number;
  total: number;
};

export type DisplayState =
  | { type: 'welcome'; shopName?: string; layout?: string; displayQr?: string }
  | {
      type: 'cart';
      shopName?: string;
      layout?: string;
      displayQr?: string;
      lines: DisplayLine[];
      subtotal: number;
      discount: number;
      total: number;
    }
  | {
      type: 'total';
      shopName?: string;
      layout?: string;
      total: number;
      method: string;
      change?: number;
    }
  | {
      // Экран оплаты переводом: показываем клиенту QR для сканирования
      type: 'pay-qr';
      shopName?: string;
      layout?: string;
      total: number;
      qr?: string; // путь /uploads/... (резолвится через fileUrl на дисплее)
      requisite?: string;
    };

function channel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  return new BroadcastChannel(DISPLAY_CHANNEL);
}

// Сколько «живёт» сохранённое рабочее состояние (корзина/итог/оплата). Если окно
// дисплея открыли позже этого срока — показываем приветствие, а не старый заказ.
const STALE_MS = 10 * 60 * 1000;

/** Сторона кассы: отправить состояние на дисплей. */
export function sendDisplay(state: DisplayState) {
  // 1) Локальная трансляция на второй монитор того же ПК (как было).
  const bc = channel();
  if (bc) {
    bc.postMessage(state);
    // Сохраняем последнее состояние + метку времени, чтобы окно, открытое позже,
    // сразу его увидело, но не «залипло» на старой корзине.
    try {
      localStorage.setItem('pp_display_last', JSON.stringify({ s: state, t: Date.now() }));
    } catch {
      /* ignore */
    }
    bc.close();
  }

  // 2) Сетевая публикация в релей — чтобы второй экран на ОТДЕЛЬНОМ компьютере
  // тоже получил состояние. Fire-and-forget: не ждём ответа и ГЛОТАЕМ любые
  // ошибки, чтобы сбой сети/сервера НИКОГДА не ронял кассу. Гейтим фичей и
  // окружением (браузер) — на сервере/при выключенной фиче ничего не шлём.
  if (typeof window !== 'undefined' && isFeatureEnabledCached('feature.customerDisplay')) {
    void publishDisplayNetwork(state);
  }
}

/** Фоновая публикация состояния в сетевой релей. Ошибки намеренно проглатываются. */
async function publishDisplayNetwork(state: DisplayState): Promise<void> {
  try {
    await api.post('/display/state', { key: DISPLAY_KEY_DEFAULT, state });
  } catch {
    /* нет сервера/сети или не авторизованы — локальный монитор уже обновлён */
  }
}

/** Сторона дисплея: подписаться на обновления. Возвращает функцию отписки. */
export function subscribeDisplay(cb: (state: DisplayState) => void): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return () => {};
  }
  const bc = new BroadcastChannel(DISPLAY_CHANNEL);
  bc.onmessage = (e: MessageEvent<DisplayState>) => {
    if (e?.data?.type) cb(e.data);
  };
  // Подхватываем последнее состояние из localStorage при открытии окна.
  try {
    const raw = localStorage.getItem('pp_display_last');
    if (raw) {
      const parsed = JSON.parse(raw);
      // Новый формат {s,t}; старый — «голое» состояние (для обратной совместимости).
      const state: DisplayState = parsed?.s ?? parsed;
      const ts: number = typeof parsed?.t === 'number' ? parsed.t : 0;
      const stale = state?.type !== 'welcome' && ts > 0 && Date.now() - ts > STALE_MS;
      if (state?.type) cb(stale ? { type: 'welcome' } : state);
    }
  } catch {
    /* ignore */
  }
  return () => bc.close();
}

/**
 * Сторона дисплея НА ОТДЕЛЬНОМ ПК: подписка через сеть (опрос релея сервера).
 * Каждую ~секунду тянем GET /display/state; пришло состояние — зовём cb(state),
 * пришёл null (нет активной корзины/не совпал токен) — показываем приветствие.
 * Возвращает функцию очистки (снимает интервал). Устойчива к размонтированию и
 * гонкам: ответы после отписки игнорируются, запросы не наслаиваются.
 */
export function subscribeDisplayNetwork(
  opts: { companyId: string; key: string; token: string },
  cb: (state: DisplayState) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  let stopped = false;
  let inFlight = false; // не запускаем новый опрос, пока не вернулся прошлый

  const qs =
    `?companyId=${encodeURIComponent(opts.companyId)}` +
    `&key=${encodeURIComponent(opts.key || DISPLAY_KEY_DEFAULT)}` +
    `&token=${encodeURIComponent(opts.token)}`;

  const poll = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const res = await api.get<{ state: DisplayState | null }>(`/display/state${qs}`);
      if (stopped) return; // отписались, пока ждали ответ — не трогаем экран
      const s = res?.state;
      cb(s && (s as DisplayState).type ? (s as DisplayState) : { type: 'welcome' });
    } catch {
      // Сеть моргнула — не мигаем на приветствие, ждём следующий тик.
    } finally {
      inFlight = false;
    }
  };

  void poll(); // первый опрос сразу, чтобы не ждать секунду на пустом экране
  const id = window.setInterval(() => void poll(), 1000);
  return () => {
    stopped = true;
    window.clearInterval(id);
  };
}

/**
 * Ссылка сопряжения для открытия второго экрана на ДРУГОМ компьютере.
 * Пример: `${origin}/customer-display?net=1&company=<id>&key=1&token=<hex>`.
 */
export function buildPairingUrl(
  origin: string,
  companyId: string,
  token: string,
  key: string = DISPLAY_KEY_DEFAULT,
): string {
  const params = new URLSearchParams({ net: '1', company: companyId, key, token });
  return `${origin}/customer-display?${params.toString()}`;
}

/** Сброс дисплея на приветствие (при закрытии/уходе с кассы). */
export function resetDisplay() {
  sendDisplay({ type: 'welcome' });
}

/** Открыть окно дисплея покупателя. */
export function openCustomerDisplay() {
  if (typeof window === 'undefined') return;
  window.open('/customer-display', 'pp-customer-display', 'width=900,height=700');
}
