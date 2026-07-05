'use client';

import type { FC, ReactNode } from 'react';
import type { DisplayState } from '@/lib/customer-display';
import { fileUrl } from '@/lib/api';
import { SkinLux } from './skin-lux';

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

/** Срок готовности (декор): до 15:00 обещаем сегодня к вечеру, позже — завтра. */
function readyText(now: string): string {
  const h = Number((now || '').split(':')[0]);
  if (Number.isFinite(h) && h >= 15) return 'Завтра до 12:00';
  return 'Сегодня в 18:00';
}

/* -------------------------------- иконки -------------------------------- */
type IcoProps = { className?: string };
const svg =
  (node: ReactNode, fill = false): FC<IcoProps> => {
    const Icon: FC<IcoProps> = ({ className }) => (
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
    Icon.displayName = 'CustomerDisplayIcon';
    return Icon;
  };

const IcoShield = svg(<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />);
const IcoClock = svg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoTruck = svg(<><rect x="2" y="7" width="12" height="9" rx="1" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>);
const IcoSpark = svg(<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />);
const IcoGift = svg(<><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13M12 8S9 3 6.5 5 9 8 12 8zM12 8s3-5 5.5-3S15 8 12 8z" /></>);
const IcoChevron = svg(<path d="M9 6l6 6-6 6" />);
const IcoStar = svg(<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8-4.3-4.1 5.9-.9Z" />, true);
const IcoCheck = svg(<path d="M20 6 9 17l-5-5" />);
const IcoClose = svg(<path d="M6 6l12 12M18 6L6 18" />);
const IcoCard = svg(<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>);
const IcoBanner = svg(<><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M5 17l4-4 3 3 3-3 4 4" /></>);
const IcoShirt = svg(<path d="M8 3l4 2 4-2 4 4-3 2v10H7V9L4 7z" />);
const IcoPhoto = svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M5 17l4-4 4 4 2-2 4 3" /></>);
const IcoWide = svg(<><rect x="3" y="8" width="18" height="9" rx="1" /><path d="M7 8V5h10v3M8 21h8" /></>);
const IcoDots = svg(<><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>);
const IcoPrinter = svg(<><path d="M7 8V4h10v4" /><rect x="4" y="8" width="16" height="8" rx="2" /><rect x="7" y="14" width="10" height="6" /></>);
const IcoLeaf = svg(<path d="M5 19C5 9 12 5 20 4c0 9-4 15-13 15-1 0-2 0-2 0zm0 0c2-4 5-7 9-9" />);

/* ------------------------------- соц-иконки ------------------------------- */
const SocInstagram: FC<IcoProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className ?? 'h-6 w-6'} aria-hidden="true">
    <defs>
      <linearGradient id="socIg" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stopColor="#FEDA75" /><stop offset="0.3" stopColor="#F58529" />
        <stop offset="0.6" stopColor="#DD2A7B" /><stop offset="1" stopColor="#8134AF" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#socIg)" />
    <circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="2" />
    <circle cx="17.2" cy="6.8" r="1.3" fill="#fff" />
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
const SocVK: FC<IcoProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className ?? 'h-6 w-6'} aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#0077FF" />
    <path d="M6.5 9c.4 2.6 2 5 4.4 5.2V9h1.5v2.4c1.4-.1 2.6-1.2 3-2.4h1.1c-.3 1.2-1.1 2.3-2 2.9 1 .5 1.7 1.5 2.2 2.6H15c-.4-.9-1.1-1.7-2.1-1.8v1.8h-.4C9.3 14.5 7.1 12 6.7 9z" fill="#fff" />
  </svg>
);

const SOCIALS: { icon: FC<IcoProps>; name: string }[] = [
  { icon: SocInstagram, name: 'Instagram' },
  { icon: SocTelegram, name: 'Telegram' },
  { icon: SocWhatsApp, name: 'WhatsApp' },
];

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
  <header className="flex shrink-0 items-center justify-between px-8 py-4">
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" className="h-11 w-11 shrink-0 object-contain" />
      <div className="flex items-baseline gap-3">
        <span className="text-[26px] font-extrabold tracking-tight text-slate-900">
          <Wordmark shop={shop} />
        </span>
        <span className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 sm:inline">
          Online Printing Service
        </span>
      </div>
    </div>
    <div className="flex items-center gap-5">
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

/* -------------------- миниатюра позиции (стопка визиток) -------------------- */
const LineThumb: FC = () => (
  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-gradient-to-br from-white to-violet-50/60 shadow-sm">
    <svg viewBox="0 0 40 40" className="h-10 w-10" aria-hidden="true">
      <rect x="7" y="15" width="26" height="16" rx="3" fill="#eef2ff" />
      <rect x="10" y="11" width="26" height="16" rx="3" fill="#fff" stroke="#e2e8f0" />
      <polygon points="17,23 21,15.5 25,23" fill="#8b5cf6" />
      <circle cx="27.5" cy="22" r="1.3" fill="#e879f9" />
      <circle cx="31" cy="22" r="1.3" fill="#38bdf8" />
    </svg>
  </span>
);

/* ------------------------- панель «Ваш заказ» (корзина) ------------------------- */
const CartAside: FC<{ state: DisplayState; now: string }> = ({ state, now }) => {
  const lines = state.type === 'cart' ? state.lines : [];
  const discount = state.type === 'cart' ? state.discount : 0;
  const total = state.type === 'cart' ? state.total : 0;
  return (
    <aside className="flex h-full min-h-0 flex-col rounded-3xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-extrabold uppercase tracking-wide text-violet-600">Ваш заказ</h2>
        <span className="relative text-slate-700">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" />
            <path d="M3 4h2l2.4 11.5a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.2L20 8H6" />
          </svg>
          {lines.length > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 px-1 text-xs font-bold text-white">
              {lines.length}
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
        <div className="min-h-0 flex-1 space-y-1 overflow-auto">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl bg-slate-50/70 p-3">
              <LineThumb />
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-bold text-slate-800">{l.name}</div>
                <div className="text-sm text-slate-400">
                  {l.qty > 1 ? `${l.qty} шт.` : `1 × ${money(l.price)}`}
                </div>
              </div>
              <div className="shrink-0 bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-xl font-extrabold text-transparent">
                {money(l.total)}
              </div>
              <IcoClose className="h-4 w-4 shrink-0 text-slate-300" />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 shrink-0 border-t border-slate-200 pt-4">
        {discount > 0 && (
          <div className="mb-2 flex items-center justify-between text-base font-semibold text-emerald-600">
            <span>Скидка</span>
            <span>−{money(discount)}</span>
          </div>
        )}
        <div className="flex items-end justify-between gap-3">
          <span className="pb-2 text-lg font-extrabold uppercase tracking-wide text-slate-500">Итого:</span>
          <span className="bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-6xl font-black leading-none tracking-tight text-transparent">
            {money(total)}
          </span>
        </div>
        {lines.length > 0 && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-100 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
              <IcoClock className="h-5 w-5" />
            </span>
            <div>
              <div className="text-xs font-medium text-slate-400">Срок готовности:</div>
              <div className="text-lg font-bold leading-tight text-slate-800">{readyText(now)}</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

/* ----------------------- фичи (преимущества) ----------------------- */
type Feature = { icon: FC<IcoProps>; title: string; tone: string };

const FEATURES_SHOWCASE: Feature[] = [
  { icon: IcoShield, title: 'Премиум качество', tone: 'bg-violet-50 text-violet-500 ring-violet-100' },
  { icon: IcoClock, title: 'Быстрые сроки', tone: 'bg-fuchsia-50 text-fuchsia-500 ring-fuchsia-100' },
  { icon: IcoPrinter, title: 'Современное оборудование', tone: 'bg-amber-50 text-amber-500 ring-amber-100' },
  { icon: IcoLeaf, title: 'Экологичные материалы', tone: 'bg-emerald-50 text-emerald-500 ring-emerald-100' },
];

const FEATURES_CATALOG: Feature[] = [
  { icon: IcoShield, title: 'Премиум качество', tone: 'bg-white text-violet-500 ring-violet-200' },
  { icon: IcoClock, title: 'Быстрые сроки', tone: 'bg-white text-violet-500 ring-violet-200' },
  { icon: IcoTruck, title: 'Доставка по городу', tone: 'bg-white text-fuchsia-500 ring-fuchsia-200' },
  { icon: IcoSpark, title: 'Индивидуальный подход', tone: 'bg-white text-fuchsia-500 ring-fuchsia-200' },
];

const FEATURES_PROMO: Feature[] = [
  { icon: IcoPrinter, title: 'Современное оборудование', tone: 'text-slate-600' },
  { icon: IcoSpark, title: 'Премиум материалы', tone: 'text-slate-600' },
  { icon: IcoClock, title: 'Быстрые сроки', tone: 'text-slate-600' },
];

/* ----------------------- каталог услуг (декор) ----------------------- */
const SERVICES: { icon: FC<IcoProps>; name: string; from: string; tone: string }[] = [
  { icon: IcoCard, name: 'Визитки', from: 'от 0.35 c.', tone: 'bg-gradient-to-br from-violet-500 to-indigo-600' },
  { icon: IcoBanner, name: 'Баннеры', from: 'от 45 c.', tone: 'bg-gradient-to-br from-fuchsia-500 to-pink-600' },
  { icon: IcoShirt, name: 'Футболки', from: 'от 85 c.', tone: 'bg-gradient-to-br from-amber-500 to-orange-600' },
  { icon: IcoPhoto, name: 'Печать фото', from: 'от 2 c.', tone: 'bg-gradient-to-br from-emerald-500 to-green-600' },
  { icon: IcoWide, name: 'Широкоформатная печать', from: 'от 120 c.', tone: 'bg-gradient-to-br from-sky-500 to-blue-600' },
  { icon: IcoDots, name: 'Другие услуги', from: 'Смотреть все', tone: 'bg-gradient-to-br from-slate-400 to-slate-500' },
];

/* ------------------------------ конфетти (декор) ------------------------------ */
const Confetti: FC = () => (
  <span aria-hidden="true">
    <span className="absolute left-[36%] top-4 h-1.5 w-3 rotate-12 rounded-full bg-orange-400" />
    <span className="absolute left-[46%] top-9 h-1.5 w-3 -rotate-45 rounded-full bg-sky-400" />
    <span className="absolute left-[55%] top-5 h-1.5 w-3 rotate-45 rounded-full bg-fuchsia-400" />
    <span className="absolute left-[62%] top-10 h-1.5 w-2.5 -rotate-12 rounded-full bg-violet-400" />
    <span className="absolute left-[70%] top-4 h-1.5 w-3 rotate-[60deg] rounded-full bg-emerald-400" />
  </span>
);

/* ------------------------------ подарок (декор) ------------------------------ */
const GiftArt: FC<IcoProps> = ({ className }) => (
  <svg viewBox="0 0 88 88" className={className ?? 'h-20 w-20'} aria-hidden="true">
    <rect x="14" y="38" width="60" height="42" rx="7" fill="#7c3aed" />
    <rect x="14" y="38" width="60" height="13" rx="7" fill="#6d28d9" />
    <rect x="9" y="27" width="70" height="16" rx="6" fill="#a78bfa" />
    <rect x="38" y="27" width="12" height="53" fill="#ec4899" />
    <path d="M44 27C33 8 14 15 26 27Z" fill="#f472b6" />
    <path d="M44 27C55 8 74 15 62 27Z" fill="#f472b6" />
    <circle cx="44" cy="27" r="5" fill="#db2777" />
  </svg>
);

/* -------------- карточка «Скидка 10%» (для светлой промо-полосы) -------------- */
const DiscountCard: FC = () => (
  <div className="relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-50 via-fuchsia-50 to-pink-50 p-5">
    <Confetti />
    <div className="relative">
      <div className="text-2xl font-black leading-tight text-slate-800">Скидка 10%</div>
      <div className="text-sm font-medium text-slate-500">на первый заказ!</div>
      <span className="mt-2.5 inline-block rounded-full bg-violet-600 px-4 py-1.5 text-sm font-bold text-white shadow-md shadow-violet-500/30">
        Подробнее
      </span>
    </div>
    <GiftArt className="h-20 w-20 shrink-0 drop-shadow-lg" />
  </div>
);

/* --------------- нижняя промо-полоса (светлая, карточками) --------------- */
const PromoStripCards: FC<{ qr?: string; vk?: boolean; qrTitle?: string; qrSub?: string }> = ({
  qr,
  vk,
  qrTitle = 'Оставьте отзыв',
  qrSub = 'Нам важно ваше мнение!',
}) => (
  <div className="grid shrink-0 grid-cols-2 gap-4 px-6 pb-6 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
    <DiscountCard />
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-sm font-bold uppercase tracking-wide text-slate-600">Нас рекомендуют</div>
      <div className="mt-1.5 flex gap-1 text-amber-400">
        {[0, 1, 2, 3, 4].map((i) => (
          <IcoStar key={i} className="h-6 w-6" />
        ))}
      </div>
      <div className="mt-1.5 text-sm font-medium text-slate-500">25 000+ довольных клиентов</div>
      <div className="mt-2">
        <Avatars />
      </div>
    </div>
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">Мы в социальных сетях</div>
      <div className="flex items-start gap-5">
        {[...SOCIALS, ...(vk ? [{ icon: SocVK, name: 'VK' }] : [])].map((s) => (
          <div key={s.name} className="flex flex-col items-center gap-1.5">
            <s.icon className="h-10 w-10" />
            <span className="text-xs font-medium text-slate-500">{s.name}</span>
          </div>
        ))}
      </div>
    </div>
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <div>
        <div className="text-sm font-bold uppercase tracking-wide text-slate-600">{qrTitle}</div>
        <div className="mt-1 text-xs text-slate-400">{qrSub}</div>
      </div>
      <QrPlaceholder className="h-[76px] w-[76px] shrink-0 rounded-xl border border-slate-200" src={qr} />
    </div>
  </div>
);

/* --------------- нижняя промо-полоса (тёмная, для «Промо») --------------- */
const PromoStripDark: FC<{ qr?: string }> = ({ qr }) => (
  <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-indigo-950 via-violet-900 to-purple-950 px-8 py-5 text-white">
    <div className="flex items-center gap-3 rounded-2xl bg-white/10 px-5 py-3.5 backdrop-blur-sm">
      <span className="flex items-center gap-1.5 text-2xl font-black">
        <IcoStar className="h-6 w-6 text-amber-400" /> 4.9
      </span>
      <div className="flex gap-0.5 text-amber-400">
        {[0, 1, 2, 3, 4].map((i) => (
          <IcoStar key={i} className="h-4 w-4" />
        ))}
      </div>
      <span className="ml-1 text-sm font-medium text-indigo-100">25 000+ довольных клиентов</span>
    </div>
    <div className="flex items-center gap-6">
      {SOCIALS.map((s) => (
        <div key={s.name} className="flex flex-col items-center gap-1">
          <s.icon className="h-10 w-10" />
          <span className="text-xs font-medium text-indigo-100">{s.name}</span>
        </div>
      ))}
    </div>
    <div className="flex items-center gap-4 rounded-2xl bg-white/10 px-5 py-3 backdrop-blur-sm">
      <div>
        <div className="text-lg font-extrabold leading-tight">Скидка 10%</div>
        <div className="text-xs text-indigo-100">на первый заказ!</div>
      </div>
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500">
        <IcoGift className="h-6 w-6" />
      </span>
    </div>
    <div className="flex items-center gap-3">
      <div className="text-right text-sm font-medium text-indigo-100">
        Отсканируйте QR
        <br />
        для быстрой связи
      </div>
      <QrPlaceholder className="h-[72px] w-[72px] rounded-xl bg-white" src={qr} />
    </div>
  </div>
);

/* ------------------------------ QR (загруженный или заглушка) ------------------------------ */
const QrPlaceholder: FC<IcoProps & { src?: string }> = ({ className, src }) =>
  src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={fileUrl(src)} alt="QR" className={`rounded-lg bg-white object-contain p-1 ${className ?? ''}`} />
  ) : (
    <div className={`grid grid-cols-4 gap-0.5 rounded-lg bg-white p-2 ${className ?? ''}`}>
      {Array.from({ length: 16 }).map((_, i) => (
        <span
          key={i}
          className={`rounded-[1px] ${[0, 1, 2, 4, 7, 8, 10, 12, 13, 15].includes(i) ? 'bg-slate-800' : 'bg-transparent'}`}
        />
      ))}
    </div>
  );

/* -------------------- векторные иллюстрации-заглушки (в стиле макетов) -------------------- */
const LogoMark: FC<{ x: number; y: number; s?: number; grad: string }> = ({ x, y, s = 1, grad }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <polygon points="0,26 14,0 28,26" fill={`url(#${grad})`} />
    <circle cx="34" cy="24" r="3" fill="#e879f9" />
    <circle cx="42" cy="24" r="3" fill="#38bdf8" />
    <circle cx="50" cy="24" r="3" fill="#fbbf24" />
  </g>
);

// Стопки визиток (для «Витрины»)
const CardArt: FC = () => (
  <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <defs>
      <linearGradient id="caBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f5f3ff" /><stop offset="1" stopColor="#e0e7ff" /></linearGradient>
      <linearGradient id="caVio" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#6366f1" /></linearGradient>
    </defs>
    <rect width="400" height="300" fill="url(#caBg)" />
    <g transform="translate(205 90) rotate(-10)">
      {[24, 18, 12, 6, 0].map((o, i) => (
        <rect key={i} x={0} y={o} width={164} height={98} rx={12} fill={i === 4 ? '#0f172a' : '#334155'} />
      ))}
      <LogoMark x={22} y={40} grad="caVio" />
    </g>
    <g transform="translate(40 135) rotate(7)">
      {[24, 18, 12, 6, 0].map((o, i) => (
        <rect key={i} x={0} y={o} width={164} height={98} rx={12} fill="#ffffff" stroke="#e2e8f0" />
      ))}
      <LogoMark x={22} y={40} grad="caVio" />
    </g>
  </svg>
);

// Креативная композиция: постер + стакан + визитки (для «Каталога»)
const CreativeArt: FC = () => (
  <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <defs>
      <linearGradient id="crBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#faf5ff" /><stop offset="1" stopColor="#eef2ff" /></linearGradient>
      <linearGradient id="crPoster" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ec4899" /><stop offset="0.5" stopColor="#8b5cf6" /><stop offset="1" stopColor="#4f46e5" /></linearGradient>
      <linearGradient id="crVio" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#6366f1" /></linearGradient>
    </defs>
    <rect width="400" height="300" fill="url(#crBg)" />
    <g transform="translate(215 35)">
      <rect width="150" height="205" rx="10" fill="url(#crPoster)" />
      <text x="18" y="62" fill="#fff" fontSize="30" fontWeight="800">BE</text>
      <text x="18" y="96" fill="#fff" fontSize="30" fontWeight="800">CREATIVE</text>
      <rect x="18" y="120" width="70" height="6" rx="3" fill="#ffffff" opacity="0.7" />
    </g>
    <g transform="translate(120 150)">
      <rect x="6" y="26" width="64" height="104" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="0" y="12" width="76" height="20" rx="6" fill="#1e293b" />
      <LogoMark x={20} y={64} s={0.7} grad="crVio" />
    </g>
    <g transform="translate(35 205) rotate(-6)">
      <rect width="130" height="78" rx="10" fill="#ffffff" stroke="#e2e8f0" />
      <LogoMark x={16} y={26} s={0.85} grad="crVio" />
    </g>
  </svg>
);

// Рабочий стол типографии: кружка + брошюры + визитки (для «Промо»)
const DeskArt: FC = () => (
  <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <defs>
      <linearGradient id="dkBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f5f3ff" /><stop offset="1" stopColor="#e0e7ff" /></linearGradient>
      <linearGradient id="dkPoster" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6366f1" /><stop offset="1" stopColor="#ec4899" /></linearGradient>
      <linearGradient id="dkVio" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#6366f1" /></linearGradient>
    </defs>
    <rect width="400" height="300" fill="url(#dkBg)" />
    <g transform="translate(210 70) rotate(6)">
      <rect width="150" height="150" rx="10" fill="url(#dkPoster)" />
      <rect x="18" y="24" width="90" height="8" rx="4" fill="#ffffff" opacity="0.85" />
      <rect x="18" y="42" width="60" height="8" rx="4" fill="#ffffff" opacity="0.6" />
    </g>
    <g transform="translate(70 130)">
      <rect x="0" y="0" width="92" height="92" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <path d="M92 24 q30 0 30 22 q0 22 -30 22" fill="none" stroke="#cbd5e1" strokeWidth="8" />
      <LogoMark x={22} y={34} grad="dkVio" />
    </g>
    <g transform="translate(150 210) rotate(-8)">
      <rect width="120" height="72" rx="10" fill="#ffffff" stroke="#e2e8f0" />
      <LogoMark x={16} y={24} s={0.8} grad="dkVio" />
    </g>
  </svg>
);

/* -------------------- фото-контейнер: иллюстрация → реальное фото (если есть) --------------------
 * Базой рисуется векторная иллюстрация в стиле макета. Если положить файл
 * (напр. /public/display/showcase.jpg), он покажется поверх и заменит иллюстрацию. */
const PhotoBlock: FC<{ className?: string; label?: string; src?: string; art?: ReactNode }> = ({
  className,
  label,
  src,
  art,
}) => (
  <div
    className={`relative flex items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-100 via-fuchsia-50 to-indigo-100 ${className ?? ''}`}
  >
    {art ? (
      <div className="absolute inset-0">{art}</div>
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/logo.svg" alt="" className="h-20 w-20 opacity-70" />
    )}
    {src && (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    )}
    {label && (
      <span className="absolute bottom-3 left-4 z-10 rounded-md bg-white/70 px-2 py-0.5 text-sm font-semibold uppercase tracking-wide text-violet-600 backdrop-blur-sm">
        {label}
      </span>
    )}
  </div>
);

/* -------------------- точки-карусель (декор) -------------------- */
const Dots: FC<{ n?: number; active?: number; className?: string }> = ({ n = 5, active = 0, className = '' }) => (
  <div className={`flex justify-center gap-1.5 ${className}`}>
    {Array.from({ length: n }).map((_, i) => (
      <span
        key={i}
        className={`h-2 rounded-full transition-all ${i === active ? 'w-6 bg-violet-500' : 'w-2 bg-slate-300'}`}
      />
    ))}
  </div>
);

/* -------------------- аватары «довольных клиентов» (декор) -------------------- */
const Avatars: FC = () => {
  const tones = ['from-violet-500 to-indigo-600', 'from-fuchsia-500 to-pink-600', 'from-sky-500 to-cyan-600', 'from-amber-500 to-orange-600'];
  return (
    <div className="flex items-center">
      {tones.map((t, i) => (
        <span
          key={i}
          className={`-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br ${t} text-xs font-bold text-white first:ml-0`}
        >
          {['А', 'М', 'К', 'С'][i]}
        </span>
      ))}
      <span className="ml-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">+1.2K</span>
    </div>
  );
};

/* --------------------- общие экраны оплаты (итог / QR) --------------------- */
const Screen: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="flex min-h-dvh w-full flex-col overflow-hidden bg-gradient-to-br from-violet-50 via-white to-indigo-50 text-slate-900 lg:h-dvh">
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
        <div className="bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-[9rem] font-black leading-none tracking-tight text-transparent">
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
        <div className="bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-7xl font-black tracking-tight text-transparent">
          {money(total)}
        </div>
        {requisite && <div className="font-mono text-2xl text-slate-500">{requisite}</div>}
      </div>
    </Screen>
  );
};

/* ============================ СКИН «Витрина товара» ============================
 * Макет 1: крупная карточка товара + фичи, полоса «Добавлено в заказ!»,
 * корзина справа, промо-карточки снизу. */
const SkinShowcase: FC<SkinProps> = ({ state, shop, now }) => {
  if (state.type === 'total') return <TotalScreen state={state} shop={shop} now={now} />;
  if (state.type === 'pay-qr') return <PayQrScreen state={state} shop={shop} now={now} />;
  const lines = state.type === 'cart' ? state.lines : [];
  const last = lines[lines.length - 1];
  const title = last?.name ?? 'Визитки';
  const badge = last ? `${last.qty} шт.` : '100 шт.';
  const desc = last
    ? `${last.qty} × ${money(last.price)} · уже в вашем заказе`
    : 'Плотная бумага 300 г/м² · Двусторонняя печать';
  return (
    <Screen>
      <Header shop={shop} now={now} />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 px-6 pb-5 lg:grid-cols-[1fr_400px]">
        <div className="flex min-h-0 flex-col gap-4">
          <section className="relative min-h-0 flex-1 rounded-3xl bg-white p-6 shadow-sm">
            <span className="absolute left-6 top-6 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/30">
              <IcoCard className="h-6 w-6" />
            </span>
            <div className="grid h-full grid-cols-1 gap-6 md:grid-cols-[1fr_260px]">
              <div className="flex min-h-0 flex-col">
                <PhotoBlock className="min-h-[200px] flex-1" src="/display/showcase.jpg" art={<CardArt />} />
                <Dots active={0} className="mt-3" />
                <div className="mt-3 flex items-center gap-3">
                  <h1 className="text-4xl font-black tracking-tight">{title}</h1>
                  <span className="rounded-full border-2 border-violet-200 px-3.5 py-1 text-sm font-bold text-violet-600">
                    {badge}
                  </span>
                </div>
                <p className="mt-1.5 text-lg text-slate-500">{desc}</p>
              </div>
              <div className="hidden flex-col justify-center md:flex">
                <div className="rounded-2xl border border-slate-100 bg-white p-2 shadow-md shadow-slate-200/60">
                  {FEATURES_SHOWCASE.map((f, i) => (
                    <div
                      key={f.title}
                      className={`flex items-center gap-3 px-3 py-3.5 ${i < FEATURES_SHOWCASE.length - 1 ? 'border-b border-slate-100' : ''}`}
                    >
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 ${f.tone}`}>
                        <f.icon className="h-5 w-5" />
                      </span>
                      <span className="font-semibold leading-tight text-slate-700">{f.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          {last && (
            <div className="relative flex shrink-0 items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-violet-100 via-fuchsia-50 to-violet-100 px-6 py-4">
              <Confetti />
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/40">
                  <IcoCheck className="h-7 w-7" />
                </span>
                <div>
                  <div className="text-2xl font-black text-slate-800">Добавлено в заказ!</div>
                  <div className="text-slate-500">
                    {last.name}, {last.qty} шт.
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-4xl font-black text-transparent">
                {money(last.total)}
              </div>
            </div>
          )}
        </div>
        <CartAside state={state} now={now} />
      </main>
      <PromoStripCards qr={state.displayQr} />
    </Screen>
  );
};

/* ============================ СКИН «Каталог услуг» ============================
 * Макет 2: список услуг слева, промо-герой в центре, корзина справа. */
const SkinCatalog: FC<SkinProps> = ({ state, shop, now }) => {
  if (state.type === 'total') return <TotalScreen state={state} shop={shop} now={now} />;
  if (state.type === 'pay-qr') return <PayQrScreen state={state} shop={shop} now={now} />;
  return (
    <Screen>
      <Header shop={shop} now={now} />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 px-6 pb-5 lg:grid-cols-[300px_1fr_380px]">
        {/* Услуги */}
        <section className="hidden min-h-0 flex-col rounded-3xl bg-white p-4 shadow-sm lg:flex">
          <div className="mb-3 shrink-0 px-2 text-sm font-extrabold uppercase tracking-wide text-slate-700">
            Наши услуги
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto">
            {SERVICES.slice(0, 5).map((s, i) => (
              <div
                key={s.name}
                className={`flex items-center gap-3 rounded-2xl p-2.5 ${
                  i === 0
                    ? 'bg-gradient-to-r from-violet-500/15 to-fuchsia-500/10 ring-2 ring-violet-400'
                    : 'border-b border-slate-100 last:border-0'
                }`}
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${s.tone}`}>
                  <s.icon className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-bold text-slate-800">{s.name}</div>
                  <div className="text-sm text-slate-400">{s.from}</div>
                </div>
                <IcoChevron className={`h-5 w-5 shrink-0 ${i === 0 ? 'text-violet-500' : 'text-slate-300'}`} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex shrink-0 items-center gap-3 rounded-2xl border border-slate-200 p-2.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
              <IcoDots className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold text-slate-800">Другие услуги</div>
              <div className="text-sm text-slate-400">Смотреть все</div>
            </div>
            <IcoChevron className="h-5 w-5 shrink-0 text-slate-300" />
          </div>
        </section>

        {/* Герой */}
        <section className="relative flex min-h-0 flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-violet-100 via-fuchsia-50 to-indigo-100 p-8">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 xl:grid-cols-[1fr_1.05fr]">
            <div className="flex flex-col">
              <h1 className="text-[2.6rem] font-black uppercase leading-[1.08] tracking-tight">
                Печатаем
                <br />
                для ваших{' '}
                <span className="bg-gradient-to-r from-violet-600 to-fuchsia-500 bg-clip-text text-transparent">идей</span>
              </h1>
              <div className="mt-4 h-1.5 w-16 rounded-full bg-gradient-to-r from-violet-500 to-sky-400" />
              <div className="mt-7 space-y-4">
                {FEATURES_CATALOG.map((f) => (
                  <div key={f.title} className="flex items-center gap-3.5">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 ${f.tone}`}>
                      <f.icon className="h-5 w-5" />
                    </span>
                    <span className="text-lg font-semibold text-slate-700">{f.title}</span>
                  </div>
                ))}
              </div>
            </div>
            <PhotoBlock className="hidden min-h-0 xl:flex" src="/display/catalog-hero.jpg" art={<CreativeArt />} />
          </div>
          <Dots active={0} className="mt-4 shrink-0" />
        </section>

        <CartAside state={state} now={now} />
      </main>
      <PromoStripCards qr={state.displayQr} vk qrTitle="Отсканируйте QR" qrSub="для быстрой связи" />
    </Screen>
  );
};

/* ============================ СКИН «Промо-витрина» ============================
 * Макет 3: большой рекламный герой, каталог услуг справа (или заказ,
 * когда корзина не пуста), тёмная промо-полоса снизу. */
const SkinPromo: FC<SkinProps> = ({ state, shop, now }) => {
  if (state.type === 'total') return <TotalScreen state={state} shop={shop} now={now} />;
  if (state.type === 'pay-qr') return <PayQrScreen state={state} shop={shop} now={now} />;
  const hasCart = state.type === 'cart' && state.lines.length > 0;
  return (
    <Screen>
      <Header shop={shop} now={now} />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 px-6 pb-5 lg:grid-cols-[1fr_420px]">
        {/* Маркетинговый герой на фоне иллюстрации */}
        <section className="relative flex min-h-0 flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-violet-100 via-fuchsia-50 to-indigo-100 p-9">
          <div className="absolute inset-y-0 right-0 hidden w-3/5 xl:block">
            <PhotoBlock className="h-full w-full rounded-none" src="/display/promo-hero.jpg" art={<DeskArt />} />
            <div className="absolute inset-0 bg-gradient-to-r from-violet-100 via-violet-100/60 to-transparent" />
          </div>
          <div className="relative max-w-xl">
            <h1 className="text-[3.2rem] font-black leading-[1.06] tracking-tight">
              Качество,
              <br />
              которое говорит
              <br />
              <span className="bg-gradient-to-r from-indigo-500 to-sky-500 bg-clip-text text-transparent">
                о вашем бизнесе
              </span>
            </h1>
            <div className="mt-4 h-1.5 w-20 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" />
            <p className="mt-5 text-xl text-slate-500">
              Профессиональная печать
              <br />
              для вашего успеха
            </p>
            <span className="mt-7 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-7 py-3.5 text-lg font-bold text-white shadow-lg shadow-violet-500/30">
              Смотреть услуги
              <IcoChevron className="h-5 w-5" />
            </span>
          </div>
          <div className="relative mt-6 flex flex-wrap gap-8">
            {FEATURES_PROMO.map((f) => (
              <div key={f.title} className="flex items-center gap-2.5 font-semibold text-slate-600">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-violet-500 shadow-sm ring-1 ring-violet-100">
                  <f.icon className="h-5 w-5" />
                </span>
                {f.title}
              </div>
            ))}
          </div>
        </section>

        {/* Справа: услуги или заказ (когда есть корзина) */}
        {hasCart ? (
          <CartAside state={state} now={now} />
        ) : (
          <section className="flex min-h-0 flex-col justify-center rounded-3xl bg-white p-4 shadow-sm">
            {SERVICES.map((s, i) => (
              <div
                key={s.name}
                className={`flex items-center gap-4 px-2 py-3.5 ${i < SERVICES.length - 1 ? 'border-b border-slate-100' : ''}`}
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${s.tone}`}>
                  <s.icon className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xl font-bold text-slate-800">{s.name}</div>
                  <div className="text-sm text-slate-400">{s.from}</div>
                </div>
                <IcoChevron className="h-5 w-5 shrink-0 text-slate-300" />
              </div>
            ))}
          </section>
        )}
      </main>
      <PromoStripDark qr={state.displayQr} />
    </Screen>
  );
};

// Реестр дополнительных скинов (мержится с базовым в page.tsx).
export const EXTRA_SKINS: Record<string, FC<SkinProps>> = {
  lux: SkinLux,
  showcase: SkinShowcase,
  catalog: SkinCatalog,
  promo: SkinPromo,
};
