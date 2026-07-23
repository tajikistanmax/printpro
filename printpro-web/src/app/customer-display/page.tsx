'use client';

import { useEffect, useState, type FC } from 'react';
import {
  subscribeDisplay,
  subscribeDisplayNetwork,
  type DisplayState,
} from '@/lib/customer-display';
import { API_BASE, DEFAULT_COMPANY_ID } from '@/lib/config';
import { DEFAULT_DISPLAY_LAYOUT } from '@/lib/display-layouts';
import { EXTRA_SKINS } from './skins';
import { fileUrl } from '@/lib/api';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Наличные',
  CARD: 'Карта',
  QR: 'QR',
  TRANSFER: 'Перевод',
};

// Категории типографии — для приветственного экрана (как в витрине)
const CATEGORIES = ['Визитки', 'Флаеры', 'Буклеты', 'Баннеры', 'Плакаты', 'Наклейки'];

function Wordmark({ shop }: { shop: string }) {
  if (shop === 'PrintPro') {
    return (
      <>
        Print<span className="text-violet-500">Pro</span>
      </>
    );
  }
  return <>{shop}</>;
}

type SkinProps = { state: DisplayState; shop: string; now: string };

/* =========================== Скин «Аврора» (по умолчанию) =========================== */
const SkinAurora: FC<SkinProps> = ({ state, shop, now }) => {
  return (
    <div className="flex min-h-screen w-full flex-col bg-gradient-to-br from-violet-50 via-white to-indigo-50 text-slate-900">
      {/* Шапка */}
      <header className="flex items-center justify-between border-b border-slate-200/70 bg-white/70 px-10 py-5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-11 w-11 shrink-0 object-contain" />
          <div className="flex flex-col leading-none">
            <span className="text-2xl font-extrabold tracking-tight">
              <Wordmark shop={shop} />
            </span>
            <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Online Printing Service
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            на связи
          </span>
          {now && (
            <span className="font-mono text-5xl font-bold tabular-nums tracking-tight text-slate-700">
              {now}
            </span>
          )}
        </div>
      </header>

      {/* Приветствие */}
      {state.type === 'welcome' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8 text-center">
          <div className="relative">
            <div className="absolute left-1/2 top-1/2 -z-10 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-300/40 blur-3xl" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.svg"
              alt="PrintPro"
              className="h-36 w-36 object-contain drop-shadow-[0_12px_40px_rgba(124,92,255,0.35)]"
            />
          </div>
          <div>
            <h1 className="text-5xl font-black tracking-tight">Добро пожаловать!</h1>
            <p className="mt-3 text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
              Типография · Полиграфия · Дизайн · Печать
            </p>
          </div>
          <div className="flex max-w-2xl flex-wrap items-center justify-center gap-2.5">
            {CATEGORIES.map((c) => (
              <span
                key={c}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Корзина */}
      {state.type === 'cart' && (
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-8 pb-8 pt-6">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="text-2xl font-bold">Ваш заказ</h2>
            <span className="rounded-full bg-violet-100 px-3.5 py-1 text-sm font-semibold text-violet-600">
              {state.lines.reduce((s, l) => s + l.qty, 0)} поз.
            </span>
          </div>

          <div className="flex-1 space-y-3 overflow-auto">
            {state.lines.map((l, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-lg font-bold text-white">
                    {(l.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold">{l.name}</div>
                    <div className="text-sm text-slate-400">
                      {l.qty} × {money(l.price)}
                    </div>
                  </div>
                </div>
                <div className="ml-4 shrink-0 text-lg font-bold">{money(l.total)}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {state.discount > 0 && (
              <div className="mb-2 flex items-center justify-between text-base font-medium text-emerald-600">
                <span>Скидка</span>
                <span>−{money(state.discount)}</span>
              </div>
            )}
            <div className="flex items-end justify-between">
              <span className="text-xl font-semibold text-slate-500">Итого</span>
              <span className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-5xl font-black tracking-tight text-transparent">
                {money(state.total)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Итог / оплата */}
      {state.type === 'total' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
          <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
            К оплате
          </div>
          <div className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-8xl font-black tracking-tight text-transparent">
            {money(state.total)}
          </div>
          {state.method && (
            <div className="rounded-full border border-slate-200 bg-white px-6 py-2.5 text-lg font-semibold text-slate-600 shadow-sm">
              {METHOD_LABEL[state.method] || state.method}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2.5 rounded-full bg-emerald-50 px-6 py-3 text-2xl font-bold text-emerald-600">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Спасибо за покупку!
          </div>
        </div>
      )}

      {state.type === 'pay-qr' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
            Оплата переводом
          </div>
          {state.qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fileUrl(state.qr)}
              alt="QR для перевода"
              className="h-72 w-72 rounded-2xl bg-white p-3 shadow-lg"
            />
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-slate-300 p-12 text-slate-400">
              QR не настроен
            </div>
          )}
          <div className="text-2xl font-bold text-slate-700">Отсканируйте и переведите</div>
          <div className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-7xl font-black tracking-tight text-transparent">
            {money(state.total)}
          </div>
          {state.requisite && (
            <div className="font-mono text-2xl text-slate-500">{state.requisite}</div>
          )}
        </div>
      )}
    </div>
  );
};

// Реестр оформлений второго экрана. Новые дизайны добавляем сюда по ключу.
const SKINS: Record<string, FC<SkinProps>> = {
  aurora: SkinAurora,
  ...EXTRA_SKINS,
};

export default function CustomerDisplayPage() {
  const [state, setState] = useState<DisplayState>({ type: 'welcome' });
  const [now, setNow] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Локальный монитор (net нет) — прежнее поведение через BroadcastChannel.
    if (params.get('net') !== '1') {
      return subscribeDisplay(setState);
    }
    // Сетевой режим: второй экран на ОТДЕЛЬНОМ ПК опрашивает релей сервера.
    // companyId: из ссылки → /system/company-id (коробка) → fallback-константа.
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      let companyId = params.get('company') || '';
      if (!companyId) {
        try {
          const res = await fetch(`${API_BASE}/system/company-id`);
          if (res.ok) {
            const data = (await res.json()) as { companyId?: string | null };
            companyId = data?.companyId || '';
          }
        } catch {
          /* офлайн — упадём на DEFAULT_COMPANY_ID ниже */
        }
      }
      if (!companyId) companyId = DEFAULT_COMPANY_ID;
      if (cancelled) return;
      cleanup = subscribeDisplayNetwork(
        { companyId, key: params.get('key') || '1', token: params.get('token') || '' },
        setState,
      );
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Часы в шапке — приятная деталь для экрана у кассы
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      );
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const shop = state.shopName || 'PrintPro';
  const layout = state.layout || DEFAULT_DISPLAY_LAYOUT;
  const Skin = SKINS[layout] ?? SKINS[DEFAULT_DISPLAY_LAYOUT];

  return <Skin state={state} shop={shop} now={now} />;
}
