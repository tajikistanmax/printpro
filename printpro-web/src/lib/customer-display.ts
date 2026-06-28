'use client';

/**
 * Дисплей покупателя (второй экран).
 *
 * Касса вещает состояние корзины через BroadcastChannel, а отдельное окно
 * /customer-display слушает его и показывает клиенту. Оба окна — на одном
 * origin, поэтому никакого сервера/сети не нужно, всё локально в браузере.
 */

export const DISPLAY_CHANNEL = 'printpro-customer-display';

export type DisplayLine = {
  name: string;
  qty: number;
  price: number;
  total: number;
};

export type DisplayState =
  | { type: 'welcome'; shopName?: string }
  | {
      type: 'cart';
      shopName?: string;
      lines: DisplayLine[];
      subtotal: number;
      discount: number;
      total: number;
    }
  | {
      type: 'total';
      shopName?: string;
      total: number;
      method: string;
      change?: number;
    };

function channel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  return new BroadcastChannel(DISPLAY_CHANNEL);
}

/** Сторона кассы: отправить состояние на дисплей. */
export function sendDisplay(state: DisplayState) {
  const bc = channel();
  if (!bc) return;
  bc.postMessage(state);
  // Сохраняем последнее состояние, чтобы окно, открытое позже, сразу его увидело.
  try {
    localStorage.setItem('pp_display_last', JSON.stringify(state));
  } catch {
    /* ignore */
  }
  bc.close();
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
    const last = localStorage.getItem('pp_display_last');
    if (last) cb(JSON.parse(last) as DisplayState);
  } catch {
    /* ignore */
  }
  return () => bc.close();
}

/** Открыть окно дисплея покупателя. */
export function openCustomerDisplay() {
  if (typeof window === 'undefined') return;
  window.open('/customer-display', 'pp-customer-display', 'width=900,height=700');
}
