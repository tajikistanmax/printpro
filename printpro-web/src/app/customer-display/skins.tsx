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
const SocVK: FC<IcoProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className ?? 'h-6 w-6'} aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="6" fill="#0077FF" />
    <path d="M6 9c.4 2.6 2 5 4.4 5.2V9h1.5v2.4c1.4-.1 2.6-1.2 3-2.4H16c-.3 1.2-1.1 2.3-2 2.9 1 .5 1.7 1.5 2.2 2.6h-1.7c-.4-.9-1.1-1.7-2.1-1.8v1.8h-.4C8.8 15 6.6 12.5 6.2 9z" fill="#fff" />
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
const PromoStripCards: FC<{ qr?: string }> = ({ qr }) => (
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
      <div className="mt-2 flex items-center justify-between">
        <Avatars />
      </div>
      <div className="mt-1 text-xs text-slate-400">25 000+ довольных клиентов</div>
    </div>
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-2 text-sm font-semibold text-slate-500">Мы в соцсетях</div>
      <div className="flex items-center gap-3">
        <SocInstagram className="h-8 w-8" />
        <SocTelegram className="h-8 w-8" />
        <SocWhatsApp className="h-8 w-8" />
        <SocVK className="h-8 w-8" />
      </div>
    </div>
    <div className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm">
      <QrPlaceholder className="h-16 w-16" src={qr} />
      <div>
        <div className="text-sm font-semibold text-slate-700">Оставьте отзыв</div>
        <div className="text-xs text-slate-400">Отсканируйте QR</div>
      </div>
    </div>
  </div>
);

/* --------------- нижняя промо-полоса (тёмная, для «Промо») --------------- */
const PromoStripDark: FC<{ qr?: string }> = ({ qr }) => (
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
      <QrPlaceholder className="h-16 w-16 bg-white" src={qr} />
    </div>
  </div>
);

/* ------------------------------ QR (загруженный или заглушка) ------------------------------ */
const QrPlaceholder: FC<IcoProps & { src?: string }> = ({ className, src }) =>
  src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={fileUrl(src)} alt="QR" className={`rounded-lg bg-white object-contain p-1 ${className ?? ''}`} />
  ) : (
    <div className={`grid grid-cols-4 gap-0.5 rounded-lg bg-white p-1.5 ${className ?? ''}`}>
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
const Dots: FC<{ n?: number; active?: number }> = ({ n = 5, active = 0 }) => (
  <div className="mt-3 flex justify-center gap-1.5">
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
      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">+1.2K</span>
    </div>
  );
};

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
  const lines = state.type === 'cart' ? state.lines : [];
  const last = lines[lines.length - 1];
  return (
    <Screen>
      <Header shop={shop} now={now} />
      <main className="grid flex-1 grid-cols-1 gap-5 px-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-h-0 flex-col gap-5">
          <section className="min-h-0 flex-1 rounded-3xl bg-white p-6 shadow-sm">
            <div className="grid h-full grid-cols-1 gap-6 md:grid-cols-[1fr_240px]">
              <div className="flex flex-col">
                <PhotoBlock className="min-h-[240px] flex-1" label="Print your vision" src="/display/showcase.jpg" art={<CardArt />} />
                <Dots active={0} />
                <div className="mt-3 flex items-center gap-3">
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
          {last && (
            <div className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-violet-100 to-fuchsia-100 px-6 py-4">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white">
                  <IcoCheck className="h-6 w-6" />
                </span>
                <div>
                  <div className="text-lg font-bold text-slate-800">Добавлено в заказ!</div>
                  <div className="text-sm text-slate-500">
                    {last.name} · {last.qty} шт.
                  </div>
                </div>
              </div>
              <div className="text-2xl font-black text-violet-600">{money(last.total)}</div>
            </div>
          )}
        </div>
        <CartAside state={state} />
      </main>
      <PromoStripCards qr={state.displayQr} />
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
          <PhotoBlock className="mt-4 h-40 bg-white/50" label="Be creative" src="/display/catalog-hero.jpg" art={<CreativeArt />} />
          <Dots active={0} />
        </section>
        <CartAside state={state} />
      </main>
      <PromoStripCards qr={state.displayQr} />
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
          <PhotoBlock className="mt-6 h-48" label="Print your success" src="/display/promo-hero.jpg" art={<DeskArt />} />
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
      <PromoStripDark qr={state.displayQr} />
    </Screen>
  );
};

// Реестр дополнительных скинов (мержится с базовым в page.tsx).
export const EXTRA_SKINS: Record<string, FC<SkinProps>> = {
  showcase: SkinShowcase,
  catalog: SkinCatalog,
  promo: SkinPromo,
};
