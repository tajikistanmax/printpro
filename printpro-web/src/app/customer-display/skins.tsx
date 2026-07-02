'use client';

import type { FC, ReactNode } from 'react';
import type { DisplayState } from '@/lib/customer-display';
import { fileUrl } from '@/lib/api';

/* ================================================================== *
 *  Дополнительные оформления второго экрана (дисплей покупателя).
 *  Живые данные (корзина, итог) приходят из состояния трансляции;
 *  промо-контент/фото — оформление (фото можно заменить своими,
 *  положив файлы в /public/display/ и подставив ниже).
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

/* -------------------------------- иконки -------------------------------- */
type IcoProps = { className?: string };
const svg =
  (node: ReactNode, fill = false): FC<IcoProps> =>
  ({ className }) =>
    (
      <svg
        viewBox="0 0 24 24"
        className={className ?? 'h-5 w-5'}
        fill={fill ? 'currentColor' : 'none'}
        stroke={fill ? 'none' : 'currentColor'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {node}
      </svg>
    );

const IcoShield = svg(<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />);
const IcoClock = svg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoTruck = svg(<><rect x="2" y="7" width="12" height="9" rx="1" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>);
const IcoSpark = svg(<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />);
const IcoGift = svg(<><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13M12 8S9 3 6.5 5 9 8 12 8zM12 8s3-5 5.5-3S15 8 12 8z" /></>);
const IcoChevron = svg(<path d="M9 6l6 6-6 6" />);
const IcoStar = svg(<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8-4.3-4.1 5.9-.9Z" />, true);
const IcoCheck = svg(<path d="M20 6 9 17l-5-5" />);
const IcoCard = svg(<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>);
const IcoBanner = svg(<><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M5 17l4-4 3 3 3-3 4 4" /></>);
const IcoShirt = svg(<path d="M8 3l4 2 4-2 4 4-3 2v10H7V9L4 7z" />);
const IcoPhoto = svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M5 17l4-4 4 4 2-2 4 3" /></>);
const IcoWide = svg(<><rect x="3" y="8" width="18" height="9" rx="1" /><path d="M7 8V5h10v3M8 21h8" /></>);
const IcoDots = svg(<><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>);

/* ------------------------------- соц-иконки ------------------------------- */
const SocInstagram: FC<IcoProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className ?? 'h-6 w-6'} aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" fill="#E1306C" />
    <circle cx="12" cy="12" r="4" fill="none" stroke="#fff" strokeWidth="2" />
    <circle cx="17" cy="7" r="1.2" fill="#fff" />
  </svg>
);
const SocTelegram: FC<IcoProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className ?? 'h-6 w-6'} aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#29A9EB" />
    <path d="M6 12l11-4-2 9-3-2-2 2-1-3z" fill="#fff" />
  </svg>
);
const SocWhatsApp: FC<IcoProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className ?? 'h-6 w-6'} aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#25D366" />
    <path d="M8 8c-1 1-1 3 1 5s4 3 5 2l-1.5-1.5-1.5.7c-.8-.4-1.9-1.5-2.3-2.3l.7-1.5z" fill="#fff" />
  </svg>
);

/* --------------------------------- шапка --------------------------------- */
function Wordmark({ shop }: { shop: string }) {
  if (shop === 'PrintPro')
    return (
      <>
        Print<span className="text-violet-500">Pro</span>
      </>
    );
  return <>{shop}</>;
}

const Header: FC<{ shop: string; now: string }> = ({ shop, now }) => (
  <header className="flex items-center justify-between px-8 py-4">
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" className="h-10 w-10 shrink-0 object-contain" />
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-extrabold tracking-tight text-slate-900">
          <Wordmark shop={shop} />
        </span>
        <span className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 sm:inline">
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
        <span className="font-mono text-4xl font-bold tabular-nums tracking-tight text-slate-800">
          {now}
        </span>
      )}
    </div>
  </header>
);

/* ------------------------- панель «Ваш заказ» (корзина) ------------------------- */
const CartAside: FC<{ state: DisplayState }> = ({ state }) => {
  const lines = state.type === 'cart' ? state.lines : [];
  const discount = state.type === 'cart' ? state.discount : 0;
  const total = state.type === 'cart' ? state.total : 0;
  const count = lines.reduce((s, l) => s + l.qty, 0);
  return (
    <aside className="flex h-full flex-col rounded-3xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-extrabold uppercase tracking-wide text-violet-600">Ваш заказ</h2>
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-600">
          <IcoCard className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-xs font-bold text-white">
              {count}
            </span>
          )}
        </span>
      </div>

      {lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
            <IcoCard className="h-8 w-8" />
          </span>
          <div className="text-lg font-semibold text-slate-500">Корзина пуста</div>
          <div className="text-sm text-slate-400">Выберите услугу или товар у кассира</div>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-auto">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-slate-100 pb-3 last:border-0">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-lg font-bold text-white">
                {(l.name || '?').slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-800">{l.name}</div>
                <div className="text-sm text-slate-400">
                  {l.qty} × {money(l.price)}
                </div>
              </div>
              <div className="shrink-0 font-bold text-slate-800">{money(l.total)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-slate-200 pt-4">
        {discount > 0 && (
          <div className="mb-2 flex items-center justify-between text-base font-medium text-emerald-600">
            <span>Скидка</span>
            <span>−{money(discount)}</span>
          </div>
        )}
        <div className="flex items-end justify-between">
          <span className="text-lg font-semibold uppercase tracking-wide text-slate-400">Итого</span>
          <span className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-5xl font-black tracking-tight text-transparent">
            {money(total)}
          </span>
        </div>
      </div>
    </aside>
  );
};

/* ----------------------- фичи (преимущества) ----------------------- */
const FEATURES: { icon: FC<IcoProps>; title: string; tone: string }[] = [
  { icon: IcoShield, title: 'Премиум качество', tone: 'bg-violet-100 text-violet-600' },
  { icon: IcoClock, title: 'Быстрые сроки', tone: 'bg-fuchsia-100 text-fuchsia-600' },
  { icon: IcoTruck, title: 'Доставка по городу', tone: 'bg-amber-100 text-amber-600' },
  { icon: IcoSpark, title: 'Индивидуальный подход', tone: 'bg-emerald-100 text-emerald-600' },
];

/* ----------------------- каталог услуг (декор) ----------------------- */
const SERVICES: { icon: FC<IcoProps>; name: string; from: string; tone: string }[] = [
  { icon: IcoCard, name: 'Визитки', from: 'от 0.35 c.', tone: 'bg-violet-500' },
  { icon: IcoBanner, name: 'Баннеры', from: 'от 45 c.', tone: 'bg-fuchsia-500' },
  { icon: IcoShirt, name: 'Футболки', from: 'от 85 c.', tone: 'bg-amber-500' },
  { icon: IcoPhoto, name: 'Печать фото', from: 'от 2 c.', tone: 'bg-emerald-500' },
  { icon: IcoWide, name: 'Широкоформатная печать', from: 'от 120 c.', tone: 'bg-sky-500' },
  { icon: IcoDots, name: 'Другие услуги', from: 'Смотреть все', tone: 'bg-slate-400' },
];

/* --------------- нижняя промо-полоса (светлая, карточками) --------------- */
const PromoStripCards: FC = () => (
  <div className="grid grid-cols-2 gap-4 px-6 pb-6 lg:grid-cols-4">
    <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-fuchsia-500 text-white">
        <IcoGift className="h-6 w-6" />
      </span>
      <div>
        <div className="text-xl font-black text-slate-800">Скидка 10%</div>
        <div className="text-sm text-slate-500">на первый заказ</div>
      </div>
    </div>
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-500">Нас рекомендуют</div>
      <div className="mt-1 flex gap-0.5 text-amber-400">
        {[0, 1, 2, 3, 4].map((i) => (
          <IcoStar key={i} className="h-5 w-5" />
        ))}
      </div>
      <div className="mt-1 text-xs text-slate-400">25 000+ довольных клиентов</div>
    </div>
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-2 text-sm font-semibold text-slate-500">Мы в соцсетях</div>
      <div className="flex items-center gap-3">
        <SocInstagram className="h-8 w-8" />
        <SocTelegram className="h-8 w-8" />
        <SocWhatsApp className="h-8 w-8" />
      </div>
    </div>
    <div className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm">
      <QrPlaceholder className="h-16 w-16" />
      <div>
        <div className="text-sm font-semibold text-slate-700">Оставьте отзыв</div>
        <div className="text-xs text-slate-400">Отсканируйте QR</div>
      </div>
    </div>
  </div>
);

/* --------------- нижняя промо-полоса (тёмная, для «Промо») --------------- */
const PromoStripDark: FC = () => (
  <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-indigo-900 to-violet-900 px-8 py-5 text-white">
    <div className="flex items-center gap-2">
      <span className="text-2xl font-black text-amber-400">★ 4.9</span>
      <div className="flex gap-0.5 text-amber-400">
        {[0, 1, 2, 3, 4].map((i) => (
          <IcoStar key={i} className="h-4 w-4" />
        ))}
      </div>
      <span className="ml-2 text-sm text-indigo-200">25 000+ довольных клиентов</span>
    </div>
    <div className="flex items-center gap-3">
      <SocInstagram className="h-8 w-8" />
      <SocTelegram className="h-8 w-8" />
      <SocWhatsApp className="h-8 w-8" />
    </div>
    <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-fuchsia-500">
        <IcoGift className="h-5 w-5" />
      </span>
      <div>
        <div className="font-bold">Скидка 10%</div>
        <div className="text-xs text-indigo-200">на первый заказ</div>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <div className="text-right text-xs text-indigo-200">
        Отсканируйте QR
        <br />
        для быстрой связи
      </div>
      <QrPlaceholder className="h-16 w-16 bg-white" />
    </div>
  </div>
);

/* ------------------------------ QR-заглушка ------------------------------ */
const QrPlaceholder: FC<IcoProps> = ({ className }) => (
  <div className={`grid grid-cols-4 gap-0.5 rounded-lg bg-white p-1.5 ${className ?? ''}`}>
    {Array.from({ length: 16 }).map((_, i) => (
      <span
        key={i}
        className={`rounded-[1px] ${[0, 1, 2, 4, 7, 8, 10, 12, 13, 15].includes(i) ? 'bg-slate-800' : 'bg-transparent'}`}
      />
    ))}
  </div>
);

/* -------------------- фото-заглушка (можно заменить своей) -------------------- */
const PhotoBlock: FC<{ className?: string; label?: string }> = ({ className, label }) => (
  <div
    className={`relative flex items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-100 via-fuchsia-50 to-indigo-100 ${className ?? ''}`}
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/logo.svg" alt="" className="h-20 w-20 opacity-70" />
    {label && (
      <span className="absolute bottom-3 left-4 text-sm font-semibold uppercase tracking-wide text-violet-400">
        {label}
      </span>
    )}
  </div>
);

/* --------------------- общие экраны оплаты (итог / QR) --------------------- */
const Screen: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="flex min-h-dvh w-full flex-col bg-gradient-to-br from-violet-50 via-white to-indigo-50 text-slate-900">
    {children}
  </div>
);

const TotalScreen: FC<SkinProps> = ({ state, shop, now }) => {
  const total = state.type === 'total' ? state.total : 0;
  const method = state.type === 'total' ? state.method : '';
  return (
    <Screen>
      <Header shop={shop} now={now} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
        <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">К оплате</div>
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-[9rem] font-black leading-none tracking-tight text-transparent">
          {money(total)}
        </div>
        {method && (
          <div className="rounded-full border border-slate-200 bg-white px-6 py-2.5 text-lg font-semibold text-slate-600 shadow-sm">
            {METHOD_LABEL[method] || method}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2.5 rounded-full bg-emerald-50 px-6 py-3 text-2xl font-bold text-emerald-600">
          <IcoCheck className="h-6 w-6" />
          Спасибо за покупку!
        </div>
      </div>
    </Screen>
  );
};

const PayQrScreen: FC<SkinProps> = ({ state, shop, now }) => {
  const total = state.type === 'pay-qr' ? state.total : 0;
  const qr = state.type === 'pay-qr' ? state.qr : undefined;
  const requisite = state.type === 'pay-qr' ? state.requisite : undefined;
  return (
    <Screen>
      <Header shop={shop} now={now} />
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
        <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Оплата переводом</div>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl(qr)} alt="QR" className="h-72 w-72 rounded-2xl bg-white p-3 shadow-lg" />
        ) : (
          <QrPlaceholder className="h-64 w-64" />
        )}
        <div className="text-2xl font-bold text-slate-700">Отсканируйте и переведите</div>
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-7xl font-black tracking-tight text-transparent">
          {money(total)}
        </div>
        {requisite && <div className="font-mono text-2xl text-slate-500">{requisite}</div>}
      </div>
    </Screen>
  );
};

/* ============================ СКИН «Витрина товара» ============================ */
const SkinShowcase: FC<SkinProps> = ({ state, shop, now }) => {
  if (state.type === 'total') return <TotalScreen state={state} shop={shop} now={now} />;
  if (state.type === 'pay-qr') return <PayQrScreen state={state} shop={shop} now={now} />;
  return (
    <Screen>
      <Header shop={shop} now={now} />
      <main className="grid flex-1 grid-cols-1 gap-5 px-6 lg:grid-cols-[1fr_380px]">
        <section className="min-h-0 rounded-3xl bg-white p-6 shadow-sm">
          <div className="grid h-full grid-cols-1 gap-6 md:grid-cols-[1fr_240px]">
            <div className="flex flex-col">
              <PhotoBlock className="min-h-[280px] flex-1" label="Print your vision" />
              <div className="mt-4 flex items-center gap-3">
                <h1 className="text-3xl font-black tracking-tight">Визитки</h1>
                <span className="rounded-full border border-violet-200 px-3 py-1 text-sm font-semibold text-violet-600">100 шт.</span>
              </div>
              <p className="mt-1 text-slate-500">Плотная бумага 300 г/м² · двусторонняя печать</p>
            </div>
            <div className="space-y-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex items-center gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${f.tone}`}>
                    <f.icon className="h-5 w-5" />
                  </span>
                  <span className="font-medium text-slate-700">{f.title}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <CartAside state={state} />
      </main>
      <PromoStripCards />
    </Screen>
  );
};

/* ============================ СКИН «Каталог услуг» ============================ */
const SkinCatalog: FC<SkinProps> = ({ state, shop, now }) => {
  if (state.type === 'total') return <TotalScreen state={state} shop={shop} now={now} />;
  if (state.type === 'pay-qr') return <PayQrScreen state={state} shop={shop} now={now} />;
  return (
    <Screen>
      <Header shop={shop} now={now} />
      <main className="grid flex-1 grid-cols-1 gap-5 px-6 lg:grid-cols-[240px_1fr_380px]">
        {/* Услуги */}
        <section className="hidden rounded-3xl bg-white p-4 shadow-sm lg:block">
          <div className="mb-3 px-2 text-sm font-bold uppercase tracking-wide text-slate-400">Наши услуги</div>
          <div className="space-y-1.5">
            {SERVICES.map((s, i) => (
              <div
                key={s.name}
                className={`flex items-center gap-3 rounded-xl p-2.5 ${i === 0 ? 'bg-violet-50 ring-1 ring-violet-200' : ''}`}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-lg text-white ${s.tone}`}>
                  <s.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-800">{s.name}</div>
                  <div className="text-xs text-slate-400">{s.from}</div>
                </div>
                <IcoChevron className="h-4 w-4 text-slate-300" />
              </div>
            ))}
          </div>
        </section>
        {/* Герой */}
        <section className="flex min-h-0 flex-col rounded-3xl bg-gradient-to-br from-violet-100 via-fuchsia-50 to-indigo-100 p-8">
          <h1 className="text-4xl font-black leading-tight tracking-tight">
            Печатаем <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent">для ваших идей</span>
          </h1>
          <div className="mt-6 grid flex-1 grid-cols-2 gap-x-6 gap-y-4 content-start">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${f.tone}`}>
                  <f.icon className="h-5 w-5" />
                </span>
                <span className="font-medium text-slate-700">{f.title}</span>
              </div>
            ))}
          </div>
          <PhotoBlock className="mt-4 h-40 bg-white/50" label="Be creative" />
        </section>
        <CartAside state={state} />
      </main>
      <PromoStripCards />
    </Screen>
  );
};

/* ============================ СКИН «Промо-витрина» ============================ */
const SkinPromo: FC<SkinProps> = ({ state, shop, now }) => {
  if (state.type === 'total') return <TotalScreen state={state} shop={shop} now={now} />;
  if (state.type === 'pay-qr') return <PayQrScreen state={state} shop={shop} now={now} />;
  const hasCart = state.type === 'cart' && state.lines.length > 0;
  return (
    <Screen>
      <Header shop={shop} now={now} />
      <main className="grid flex-1 grid-cols-1 gap-6 px-6 lg:grid-cols-[1fr_420px]">
        {/* Маркетинговый блок */}
        <section className="flex min-h-0 flex-col justify-center">
          <h1 className="text-5xl font-black leading-[1.05] tracking-tight">
            Качество,
            <br />
            которое говорит
            <br />
            <span className="bg-gradient-to-r from-fuchsia-600 to-violet-600 bg-clip-text text-transparent">о вашем бизнесе</span>
          </h1>
          <div className="mt-4 h-1 w-24 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" />
          <p className="mt-5 max-w-md text-lg text-slate-500">Профессиональная печать для вашего успеха</p>
          <div className="mt-6 flex flex-wrap gap-6">
            {FEATURES.slice(0, 3).map((f) => (
              <div key={f.title} className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${f.tone}`}>
                  <f.icon className="h-4 w-4" />
                </span>
                {f.title}
              </div>
            ))}
          </div>
          <PhotoBlock className="mt-6 h-48" label="Print your success" />
        </section>
        {/* Справа: услуги или заказ (когда есть корзина) */}
        {hasCart ? (
          <CartAside state={state} />
        ) : (
          <section className="rounded-3xl bg-white p-4 shadow-sm">
            {SERVICES.map((s, i) => (
              <div key={s.name} className={`flex items-center gap-4 p-3.5 ${i < SERVICES.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <span className={`flex h-12 w-12 items-center justify-center rounded-xl text-white ${s.tone}`}>
                  <s.icon className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-bold text-slate-800">{s.name}</div>
                  <div className="text-sm text-slate-400">{s.from}</div>
                </div>
                <IcoChevron className="h-5 w-5 text-slate-300" />
              </div>
            ))}
          </section>
        )}
      </main>
      <PromoStripDark />
    </Screen>
  );
};

// Реестр дополнительных скинов (мержится с базовым в page.tsx).
export const EXTRA_SKINS: Record<string, FC<SkinProps>> = {
  showcase: SkinShowcase,
  catalog: SkinCatalog,
  promo: SkinPromo,
};
