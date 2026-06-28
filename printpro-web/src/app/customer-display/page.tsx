'use client';

import { useEffect, useState } from 'react';
import { subscribeDisplay, type DisplayState } from '@/lib/customer-display';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Наличные',
  CARD: 'Карта',
  QR: 'QR',
  TRANSFER: 'Перевод',
};

export default function CustomerDisplayPage() {
  const [state, setState] = useState<DisplayState>({ type: 'welcome' });

  useEffect(() => subscribeDisplay(setState), []);

  const shop = state.shopName || 'PrintPro';

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-900 text-white">
      {/* Шапка */}
      <header className="flex items-center gap-3 px-8 py-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-lg font-black">
          {shop.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-xl font-extrabold tracking-tight">{shop}</span>
      </header>

      {state.type === 'welcome' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="text-6xl">🛍️</div>
          <div className="text-4xl font-extrabold">Добро пожаловать!</div>
          <div className="text-lg text-slate-400">
            Здесь появится ваш заказ
          </div>
        </div>
      )}

      {state.type === 'cart' && (
        <div className="flex flex-1 flex-col px-8 pb-8">
          <div className="mb-4 flex items-baseline justify-between border-b border-white/10 pb-3">
            <span className="text-lg font-semibold text-slate-300">
              Ваш заказ
            </span>
            <span className="text-sm text-slate-400">
              {state.lines.reduce((s, l) => s + l.qty, 0)} поз.
            </span>
          </div>

          <div className="flex-1 space-y-2 overflow-auto">
            {state.lines.map((l, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-lg font-medium">{l.name}</div>
                  <div className="text-sm text-slate-400">
                    {l.qty} × {money(l.price)}
                  </div>
                </div>
                <div className="ml-4 shrink-0 text-lg font-semibold">
                  {money(l.total)}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-white/10 pt-4">
            {state.discount > 0 && (
              <div className="mb-1 flex items-center justify-between text-base text-emerald-400">
                <span>Скидка</span>
                <span>−{money(state.discount)}</span>
              </div>
            )}
            <div className="flex items-end justify-between">
              <span className="text-xl font-semibold text-slate-300">Итого</span>
              <span className="text-5xl font-black tracking-tight">
                {money(state.total)}
              </span>
            </div>
          </div>
        </div>
      )}

      {state.type === 'total' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <div className="text-2xl font-semibold text-slate-400">К оплате</div>
          <div className="text-7xl font-black tracking-tight">
            {money(state.total)}
          </div>
          {state.method && (
            <div className="rounded-full bg-white/10 px-5 py-2 text-lg font-medium">
              {METHOD_LABEL[state.method] || state.method}
            </div>
          )}
          <div className="mt-2 text-3xl font-extrabold text-emerald-400">
            Спасибо за покупку! 🎉
          </div>
        </div>
      )}
    </div>
  );
}
