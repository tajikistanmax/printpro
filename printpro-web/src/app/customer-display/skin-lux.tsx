'use client';

import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import type { DisplayState } from '@/lib/customer-display';
import { fileUrl } from '@/lib/api';

/* ================================================================== *
 *  Скин «Люкс» — тёмный премиум-экран покупателя.
 *  Стеклянные карточки, мягкое неоновое свечение, крупная типографика,
 *  анимация добавления позиций и успешной оплаты.
 * ================================================================== */

export type SkinProps = { state: DisplayState; shop: string; now: string };

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Наличные',
  CARD: 'Карта',
  QR: 'QR',
  TRANSFER: 'Перевод',
};

/* ------------------------------- иконки ------------------------------- */
type IcoProps = { className?: string };
const svg =
  (node: ReactNode): FC<IcoProps> =>
  ({ className }) =>
    (
      <svg
        viewBox="0 0 24 24"
        className={className ?? 'h-5 w-5'}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {node}
      </svg>
    );

const IcoCard = svg(<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>);
const IcoFlyer = svg(<><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4M9 12h6M9 16h4" /></>);
const IcoBanner = svg(<><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M5 17l4-4 3 3 3-3 4 4" /></>);
const IcoSticker = svg(<><path d="M12 3a9 9 0 1 0 9 9h-6a3 3 0 0 1-3-3V3z" /><path d="M15 3a9 9 0 0 1 6 6" /></>);
const IcoShirt = svg(<path d="M8 3l4 2 4-2 4 4-3 2v10H7V9L4 7z" />);
const IcoPhoto = svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M5 17l4-4 4 4 2-2 4 3" /></>);
const IcoShield = svg(<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />);
const IcoClock = svg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoTruck = svg(<><rect x="2" y="7" width="12" height="9" rx="1" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>);
const IcoBag = svg(<><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>);
const IcoQrScan = svg(<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M4 12h16" /></>);
const IcoStar: FC<IcoProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className ?? 'h-4 w-4'} aria-hidden="true">
    <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8-4.3-4.1 5.9-.9Z" />
  </svg>
);

/* ------------------------ декоративные категории ------------------------ */
const CATEGORIES: { icon: FC<IcoProps>; name: string }[] = [
  { icon: IcoCard, name: 'Визитки' },
  { icon: IcoFlyer, name: 'Флаеры' },
  { icon: IcoBanner, name: 'Баннеры' },
  { icon: IcoSticker, name: 'Наклейки' },
  { icon: IcoShirt, name: 'Футболки' },
  { icon: IcoPhoto, name: 'Фотопечать' },
];

const FEATURES: { icon: FC<IcoProps>; title: string }[] = [
  { icon: IcoShield, title: 'Премиум качество' },
  { icon: IcoClock, title: 'Быстрые сроки' },
  { icon: IcoTruck, title: 'Доставка по городу' },
];

/* ------------------------------ обёртка ------------------------------ */
const Stage: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#070b19] text-slate-100">
    {/* Неоновое свечение на фоне */}
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="pp-drift-a absolute -left-48 -top-48 h-[36rem] w-[36rem] rounded-full bg-indigo-600/25 blur-[140px]" />
      <div className="pp-drift-b absolute -right-48 top-1/4 h-[32rem] w-[32rem] rounded-full bg-fuchsia-600/15 blur-[140px]" />
      <div className="pp-drift-a absolute -bottom-56 left-1/3 h-[30rem] w-[30rem] rounded-full bg-violet-600/20 blur-[150px]" />
    </div>
    <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
  </div>
);

function Wordmark({ shop }: { shop: string }) {
  if (shop === 'PrintPro')
    return (
      <>
        Print
        <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Pro</span>
      </>
    );
  return <>{shop}</>;
}

const Header: FC<{ shop: string; now: string }> = ({ shop, now }) => (
  <header className="flex items-center justify-between px-10 py-5">
    <div className="flex items-center gap-3.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" className="h-11 w-11 shrink-0 object-contain drop-shadow-[0_0_18px_rgba(139,92,246,0.55)]" />
      <div className="flex flex-col leading-none">
        <span className="text-2xl font-extrabold tracking-tight text-white">
          <Wordmark shop={shop} />
        </span>
        <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
          Типография · Полиграфия
        </span>
      </div>
    </div>
    <div className="flex items-center gap-5">
      <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm font-medium text-slate-400 backdrop-blur-sm">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        на связи
      </span>
      {now && (
        <span className="font-mono text-5xl font-bold tabular-nums tracking-tight text-white/90">{now}</span>
      )}
    </div>
  </header>
);

/* ------------------------------ QR-блок ------------------------------ */
const QrCard: FC<{ src?: string; title: string; hint: string }> = ({ src, title, hint }) =>
  src ? (
    <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fileUrl(src)} alt="QR" className="h-20 w-20 shrink-0 rounded-xl bg-white object-contain p-1.5" />
      <div>
        <div className="font-semibold text-white">{title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-400">
          <IcoQrScan className="h-4 w-4" />
          {hint}
        </div>
      </div>
    </div>
  ) : null;

/* ============================ Приветствие ============================ */
const WelcomeScreen: FC<SkinProps> = ({ state, shop, now }) => {
  const qr = state.type === 'welcome' ? state.displayQr : undefined;
  return (
    <Stage>
      <Header shop={shop} now={now} />
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-9 px-10 text-center">
        <div className="pp-fade-up flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-300 backdrop-blur-sm">
          Добро пожаловать
        </div>
        <h1 className="pp-fade-up max-w-4xl text-6xl font-black leading-[1.08] tracking-tight text-white" style={{ animationDelay: '90ms' }}>
          Печатаем{' '}
          <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            ваши идеи
          </span>
        </h1>
        <div className="pp-fade-up flex max-w-3xl flex-wrap items-center justify-center gap-3" style={{ animationDelay: '180ms' }}>
          {CATEGORIES.map((c) => (
            <span
              key={c.name}
              className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-base font-medium text-slate-200 backdrop-blur-sm"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/40 to-violet-500/40 text-violet-200">
                <c.icon className="h-4.5 w-4.5" />
              </span>
              {c.name}
            </span>
          ))}
        </div>
      </main>
      <footer className="flex items-center justify-between gap-6 border-t border-white/5 bg-white/[0.03] px-10 py-5 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5 text-amber-400">
            {[0, 1, 2, 3, 4].map((i) => (
              <IcoStar key={i} className="h-5 w-5" />
            ))}
          </div>
          <span className="text-sm font-medium text-slate-400">Нас рекомендуют клиенты</span>
        </div>
        <div className="hidden items-center gap-7 lg:flex">
          {FEATURES.map((f) => (
            <span key={f.title} className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-violet-300">
                <f.icon className="h-4 w-4" />
              </span>
              {f.title}
            </span>
          ))}
        </div>
        {qr ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(qr)} alt="QR" className="h-16 w-16 rounded-lg bg-white object-contain p-1" />
            <div className="text-left text-xs leading-relaxed text-slate-400">
              Отсканируйте QR —<br />
              оставьте отзыв
            </div>
          </div>
        ) : (
          <span className="text-xs uppercase tracking-[0.2em] text-slate-600">Design · Print · Delivery</span>
        )}
      </footer>
    </Stage>
  );
};

/* ============================ Корзина ============================ */
const CartScreen: FC<SkinProps & { hot: number }> = ({ state, shop, now, hot }) => {
  const lines = state.type === 'cart' ? state.lines : [];
  const discount = state.type === 'cart' ? state.discount : 0;
  const subtotal = state.type === 'cart' ? state.subtotal : 0;
  const total = state.type === 'cart' ? state.total : 0;
  const qr = state.type === 'cart' ? state.displayQr : undefined;
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const listRef = useRef<HTMLDivElement>(null);

  // Новая позиция — плавно показываем её (прокрутка вниз списка)
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length]);

  return (
    <Stage>
      <Header shop={shop} now={now} />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-6 px-10 pb-8 lg:grid-cols-[1fr_420px]">
        {/* Список позиций */}
        <section className="flex min-h-0 flex-col">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">Ваш заказ</h2>
            <span className="rounded-full border border-violet-400/30 bg-violet-500/15 px-4 py-1.5 text-sm font-semibold text-violet-300">
              {lines.length} поз.
            </span>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {lines.map((l, i) => (
              <div
                key={i}
                className={`pp-fade-up flex items-center justify-between rounded-2xl border p-5 backdrop-blur-sm transition-colors duration-700 ${
                  i === hot
                    ? 'border-violet-400/60 bg-violet-500/15 shadow-[0_0_35px_rgba(139,92,246,0.25)]'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                <div className="flex min-w-0 items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 font-mono text-base font-bold text-white shadow-[0_4px_18px_rgba(99,102,241,0.4)]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xl font-semibold text-white">{l.name}</div>
                    <div className="mt-0.5 text-sm text-slate-400">
                      {l.qty} × {money(l.price)}
                    </div>
                  </div>
                </div>
                <div className="ml-5 shrink-0 text-xl font-bold tabular-nums text-white">{money(l.total)}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Итог */}
        <aside className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-white/5 p-7 backdrop-blur-md">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/40 to-violet-500/40 text-violet-200">
              <IcoBag className="h-5 w-5" />
            </span>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Итог заказа</span>
          </div>

          <div className="space-y-3.5 text-base">
            <div className="flex items-center justify-between text-slate-400">
              <span>Позиций</span>
              <span className="font-medium tabular-nums text-slate-200">{lines.length}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Единиц</span>
              <span className="font-medium tabular-nums text-slate-200">{units}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Сумма</span>
              <span className="font-medium tabular-nums text-slate-200">{money(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex items-center justify-between font-medium text-emerald-400">
                <span>Скидка</span>
                <span className="tabular-nums">−{money(discount)}</span>
              </div>
            )}
          </div>

          <div className="my-6 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

          <div className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">Итого к оплате</div>
          <div
            key={total}
            className="pp-pop mt-2 bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-6xl font-black tabular-nums tracking-tight text-transparent"
          >
            {money(total)}
          </div>
          {discount > 0 && (
            <div className="mt-4 inline-flex items-center gap-2 self-start rounded-full border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-300">
              Вы экономите {money(discount)}
            </div>
          )}

          <div className="mt-auto pt-6">
            <QrCard src={qr} title="Оставьте отзыв" hint="Отсканируйте камерой" />
          </div>
        </aside>
      </main>
    </Stage>
  );
};

/* ============================ Оплачено ============================ */
const TotalScreen: FC<SkinProps> = ({ state, shop, now }) => {
  const total = state.type === 'total' ? state.total : 0;
  const method = state.type === 'total' ? state.method : '';
  return (
    <Stage>
      <Header shop={shop} now={now} />
      <main className="flex flex-1 flex-col items-center justify-center gap-7 px-10 text-center">
        <div className="relative">
          <div className="pp-glow absolute left-1/2 top-1/2 -z-10 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/25 blur-3xl" />
          <svg viewBox="0 0 120 120" className="h-40 w-40" aria-hidden="true">
            <defs>
              <linearGradient id="luxRing" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#34d399" />
                <stop offset="1" stopColor="#10b981" />
              </linearGradient>
            </defs>
            <circle
              cx="60" cy="60" r="54" fill="none" stroke="url(#luxRing)" strokeWidth="5" strokeLinecap="round"
              strokeDasharray="339.3" strokeDashoffset="339.3" transform="rotate(-90 60 60)"
              style={{ animation: 'pp-draw 0.7s ease-out forwards' }}
            />
            <path
              d="M38 62l16 16 30-34" fill="none" stroke="#34d399" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray="70" strokeDashoffset="70"
              style={{ animation: 'pp-draw 0.45s ease-out 0.6s forwards' }}
            />
          </svg>
        </div>
        <div className="pp-fade-up text-xs font-bold uppercase tracking-[0.3em] text-slate-400" style={{ animationDelay: '250ms' }}>
          Оплата принята
        </div>
        <div
          className="pp-pop bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-8xl font-black tabular-nums tracking-tight text-transparent"
          style={{ animationDelay: '150ms' }}
        >
          {money(total)}
        </div>
        {method && (
          <div className="pp-fade-up rounded-full border border-white/10 bg-white/5 px-6 py-2.5 text-lg font-semibold text-slate-300 backdrop-blur-sm" style={{ animationDelay: '350ms' }}>
            {METHOD_LABEL[method] || method}
          </div>
        )}
        <div className="pp-fade-up text-3xl font-bold text-white" style={{ animationDelay: '450ms' }}>
          Спасибо за покупку!
          <div className="mt-2 text-base font-medium text-slate-400">Ждём вас снова</div>
        </div>
      </main>
    </Stage>
  );
};

/* ============================ Оплата по QR ============================ */
const PayQrScreen: FC<SkinProps> = ({ state, shop, now }) => {
  const total = state.type === 'pay-qr' ? state.total : 0;
  const qr = state.type === 'pay-qr' ? state.qr : undefined;
  const requisite = state.type === 'pay-qr' ? state.requisite : undefined;
  const steps = ['Откройте приложение банка', 'Отсканируйте QR-код', 'Переведите точную сумму'];
  return (
    <Stage>
      <Header shop={shop} now={now} />
      <main className="flex flex-1 items-center justify-center gap-16 px-10">
        <div className="max-w-md">
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Оплата переводом</div>
          <div className="mt-4 bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-7xl font-black tabular-nums tracking-tight text-transparent">
            {money(total)}
          </div>
          <div className="mt-8 space-y-4">
            {steps.map((s, i) => (
              <div key={s} className="pp-fade-up flex items-center gap-4" style={{ animationDelay: `${i * 120}ms` }}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-lg font-medium text-slate-200">{s}</span>
              </div>
            ))}
          </div>
          {requisite && (
            <div className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 backdrop-blur-sm">
              <IcoCard className="h-5 w-5 text-violet-300" />
              <span className="font-mono text-xl text-slate-200">{requisite}</span>
            </div>
          )}
        </div>
        <div className="relative shrink-0">
          <div className="pp-glow absolute left-1/2 top-1/2 -z-10 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/30 blur-3xl" />
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(qr)} alt="QR для перевода" className="pp-pop h-80 w-80 rounded-3xl bg-white object-contain p-4 shadow-2xl" />
          ) : (
            <div className="flex h-80 w-80 items-center justify-center rounded-3xl border-2 border-dashed border-white/20 text-slate-500">
              QR не настроен
            </div>
          )}
        </div>
      </main>
    </Stage>
  );
};

/* ============================ Скин целиком ============================ */
export const SkinLux: FC<SkinProps> = ({ state, shop, now }) => {
  // Подсветка изменённой позиции: сравниваем «имя:кол-во» с прошлым состоянием.
  const lines = state.type === 'cart' ? state.lines : [];
  const sig = lines.map((l) => `${l.name}:${l.qty}`).join('|');
  const prevRef = useRef<string[]>([]);
  const [hot, setHot] = useState(-1);
  useEffect(() => {
    const cur = sig ? sig.split('|') : [];
    const prev = prevRef.current;
    prevRef.current = cur;
    let idx = -1;
    cur.forEach((s, i) => {
      if (prev[i] !== s) idx = i;
    });
    if (idx >= 0) {
      setHot(idx);
      const t = setTimeout(() => setHot(-1), 1800);
      return () => clearTimeout(t);
    }
  }, [sig]);

  if (state.type === 'total') return <TotalScreen state={state} shop={shop} now={now} />;
  if (state.type === 'pay-qr') return <PayQrScreen state={state} shop={shop} now={now} />;
  if (state.type === 'cart' && state.lines.length > 0)
    return <CartScreen state={state} shop={shop} now={now} hot={hot} />;
  return <WelcomeScreen state={state} shop={shop} now={now} />;
};
