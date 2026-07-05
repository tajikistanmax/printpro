'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction, FC } from 'react';
import { api, fileUrl } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { SkinPrime } from './_pos-prime';

// ===== Общий тип данных, который контейнер кассы передаёт в любой «скин» =====
export interface CartItem {
  key: string;
  itemType: 'SERVICE' | 'PRODUCT';
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface PosMethod {
  k: string;
  l: string;
}

export interface OrderStats {
  active: number;
  inWork: number;
  ready: number;
  overdue: number;
}

export interface PosCtx {
  money: (n: number) => string;
  // сырые данные (для произвольных оформлений)
  services: any[];
  products: any[];
  serviceCats: any[];
  productCats: any[];
  // простая навигация (для классического скина)
  tab: 'SERVICE' | 'PRODUCT';
  switchTab: (t: 'SERVICE' | 'PRODUCT') => void;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  cats: any[];
  catFilter: string;
  setCatFilter: Dispatch<SetStateAction<string>>;
  filtered: any[];
  catalogAll: any[];
  // действия с каталогом
  priceOf: (item: any, type: 'SERVICE' | 'PRODUCT') => number;
  addItem: (item: any, type: 'SERVICE' | 'PRODUCT') => void;
  // корзина
  cart: CartItem[];
  setQty: (key: string, q: number) => void;
  clearCart: () => void;
  cartCount: number;
  // суммы
  subtotal: number;
  discount: string;
  setDiscount: Dispatch<SetStateAction<string>>;
  disc: number;
  promoCode: string;
  setPromoCode: Dispatch<SetStateAction<string>>;
  promoDiscount: number;
  setPromoDiscount: Dispatch<SetStateAction<number>>;
  promoMsg: string;
  setPromoMsg: Dispatch<SetStateAction<string>>;
  checkPromo: () => void;
  useBonus: string;
  setUseBonus: Dispatch<SetStateAction<string>>;
  total: number;
  // оплата
  phone: string;
  setPhone: Dispatch<SetStateAction<string>>;
  clientName: string;
  setClientName: Dispatch<SetStateAction<string>>;
  method: string;
  setMethod: Dispatch<SetStateAction<string>>;
  methods: PosMethod[];
  split: boolean;
  setSplit: Dispatch<SetStateAction<boolean>>;
  splitAmounts: Record<string, string>;
  setSplitAmounts: Dispatch<SetStateAction<Record<string, string>>>;
  splitSum: number;
  splitLeft: number;
  splitMethods: PosMethod[];
  isMixed: boolean;
  cashReceived: string;
  setCashReceived: Dispatch<SetStateAction<string>>;
  change: number;
  note: string;
  setNote: Dispatch<SetStateAction<string>>;
  debtEnabled: boolean;
  promoEnabled: boolean;
  scan: (code: string) => void;
  scanMsg: string;
  transferQr: string;
  transferRequisite: string;
  pay: () => void;
  payWith: (method: string) => void;
  msg: string;
  // для богатых оформлений
  recentOrders: any[];
  orderStats: OrderStats;
  // отложить текущий чек (held)
  hold: () => void;
}

// ===== Мелкие хелперы оформления =====
const GRADS = [
  'from-indigo-400 to-violet-500',
  'from-sky-400 to-blue-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
  'from-rose-400 to-pink-500',
  'from-fuchsia-400 to-purple-500',
  'from-cyan-400 to-sky-500',
];
function tileGrad(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADS[h % GRADS.length];
}
function initial(name: string) {
  const t = (name || '').trim();
  return t ? t[0].toUpperCase() : '?';
}

// Множество id категории + всех её подкатегорий (двухуровневые категории) —
// чтобы фильтр по родительской категории показывал и товары из подкатегорий.
function catWithDescendants(cats: any[], id: string): Set<string> {
  const set = new Set<string>([id]);
  let added = true;
  while (added) {
    added = false;
    for (const c of cats) {
      if (c.parentId && set.has(c.parentId) && !set.has(c.id)) {
        set.add(c.id);
        added = true;
      }
    }
  }
  return set;
}

// ===== Спокойные тинты плиток (вместо радужных градиентов) =====
const SOFT_TILES = [
  'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
  'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
];
function softTile(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SOFT_TILES[h % SOFT_TILES.length];
}

/** Квадратная плитка-«миниатюра»: фото товара, если есть; иначе инициал с тинтом. */
function Thumb({
  name,
  src,
  className = 'h-11 w-11 rounded-lg text-sm',
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={fileUrl(src)} alt={name} className={`shrink-0 bg-slate-100 object-cover dark:bg-slate-800 ${className}`} />
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center font-bold ${softTile(name)} ${className}`}
    >
      {initial(name)}
    </div>
  );
}

// ===== Иконки (инлайн SVG, единый stroke 1.75 — стиль NavIcons) =====
type PIcon = { className?: string };
function svg(children: React.ReactNode) {
  return function Icon({ className = 'h-[18px] w-[18px]' }: PIcon) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {children}
      </svg>
    );
  };
}
const IcoReceipt = svg(<>
  <path d="M5 3v18l2-1.2L9 21l2-1.2L13 21l2-1.2L17 21l2 0V3l-2 1.2L15 3l-2 1.2L11 3 9 4.2 7 3Z" />
  <path d="M8 8h8M8 12h8M8 16h5" />
</>);
const IcoTrash = svg(<>
  <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" />
  <path d="M10 11v6M14 11v6" />
</>);
const IcoPercent = svg(<>
  <path d="M19 5 5 19" /><circle cx="7" cy="7" r="2.2" /><circle cx="17" cy="17" r="2.2" />
</>);
const IcoUser = svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
const IcoComment = svg(<><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12Z" /></>);
const IcoPause = svg(<><path d="M9 5v14M15 5v14" /></>);
const IcoSearch = svg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>);
const IcoGrid = svg(<>
  <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
  <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
</>);
const IcoList = svg(<><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>);
const IcoPlus = svg(<><path d="M12 5v14M5 12h14" /></>);
const IcoStar = (props: PIcon) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={props.className ?? 'h-4 w-4'} aria-hidden="true">
    <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8-4.3-4.1 5.9-.9Z" />
  </svg>
);

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={muted ? 'text-slate-600' : 'font-medium text-slate-800'}>
        {value}
      </span>
    </div>
  );
}

function useCombined(c: PosCtx) {
  const items = useMemo(
    () => [
      ...c.services.map((s) => ({ ...s, _type: 'SERVICE' as const })),
      ...c.products.map((p) => ({ ...p, _type: 'PRODUCT' as const })),
    ],
    [c.services, c.products],
  );
  const allCats = useMemo(
    () => [...c.serviceCats, ...c.productCats],
    [c.serviceCats, c.productCats],
  );
  return { items, allCats };
}

// =====================================================================
// Скин «Витрина» (Дизайн 1, светлый)
// =====================================================================
function CatRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-indigo-600 text-white shadow-sm'
          : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <span className="truncate">{label}</span>
      <span
        className={`ml-2 rounded-full px-1.5 text-xs ${
          active ? 'bg-white/20 text-white' : 'bg-slate-200/70 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function ActionTile({
  icon,
  label,
  tone = 'indigo',
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: string;
  onClick: () => void;
}) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
    sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  };
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200/70 bg-white py-4 text-sm font-medium text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700/60 dark:text-slate-300"
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone] ?? tones.indigo}`}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function OrderPanelShop({ ctx }: { ctx: PosCtx }) {
  const c = ctx;
  const [showPromo, setShowPromo] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showCashPay, setShowCashPay] = useState(false);

  // Подсказки сумм «получено» — округление вверх до 100/500/1000
  const cashSuggest = Array.from(
    new Set(
      [
        Math.ceil(c.total / 100) * 100,
        Math.ceil(c.total / 500) * 500,
        Math.ceil(c.total / 1000) * 1000,
      ].filter((v) => v > c.total),
    ),
  ).slice(0, 3);

  // Поиск клиента для оплаты «в долг» (в отдельном окне)
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<any[]>([]);
  const [, setPickedClient] = useState<any | null>(null);
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientName, setNewClientName] = useState('');
  useEffect(() => {
    if (clientQuery.trim().length < 2) {
      return;
    }
    const t = setTimeout(() => {
      api
        .get(`/clients?companyId=${DEFAULT_COMPANY_ID}&search=${encodeURIComponent(clientQuery.trim())}&pageSize=8`)
        .then((r) => setClientResults(r?.items ?? (Array.isArray(r) ? r : [])))
        .catch(() => setClientResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [clientQuery]);
  const visibleClientResults =
    clientQuery.trim().length >= 2 ? clientResults : [];
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm xl:sticky xl:top-4 xl:self-start dark:border-slate-700/60">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Текущий заказ</h2>
        <span className="text-sm text-slate-400">{c.cartCount} поз.</span>
      </div>

      {c.cart.length === 0 ? (
        <div className="py-12 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
            <IcoReceipt className="h-6 w-6" />
          </span>
          <p className="text-sm text-slate-400">Добавьте товары и услуги</p>
        </div>
      ) : (
        <div className="mb-4 max-h-[44vh] space-y-3 overflow-auto pr-1">
          {c.cart.map((item) => (
            <div key={item.key} className="flex gap-3">
              <Thumb name={item.name} />
              <div className="flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {item.name}
                  </div>
                  <div className="whitespace-nowrap text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {c.money(item.unitPrice * item.quantity)}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => c.setQty(item.key, item.quantity - 1)}
                      aria-label="Убрать"
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-medium tabular-nums">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => c.setQty(item.key, item.quantity + 1)}
                      aria-label="Добавить"
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                    >
                      +
                    </button>
                  </div>
                  <button
                    onClick={() => c.setQty(item.key, 0)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 dark:text-slate-500 dark:hover:bg-rose-500/10"
                    title="Убрать"
                    aria-label="Убрать позицию"
                  >
                    <IcoTrash className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNote || c.note ? (
        <textarea
          value={c.note}
          onChange={(e) => c.setNote(e.target.value)}
          placeholder="Примечание к заказу…"
          rows={2}
          autoFocus
          className="mb-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        />
      ) : (
        <button
          onClick={() => setShowNote(true)}
          className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 py-2.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 dark:border-slate-700 dark:hover:bg-indigo-500/10"
        >
          <IcoPlus className="h-4 w-4" /> Добавить примечание к заказу
        </button>
      )}

      <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
        <Row label="Сумма товаров" value={c.money(c.subtotal)} muted />
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Скидка</span>
          <div className="flex items-center gap-2">
            {c.disc > 0 && (
              <span className="text-emerald-600">− {c.money(c.disc)}</span>
            )}
            <input
              value={c.discount}
              onChange={(e) => c.setDiscount(e.target.value)}
              type="number"
              min="0"
              placeholder="0"
              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right"
            />
          </div>
        </div>
        {c.promoEnabled && (
        <>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Промокод</span>
          {showPromo ? (
            <div className="flex items-center gap-1">
              <input
                value={c.promoCode}
                onChange={(e) => {
                  c.setPromoCode(e.target.value);
                  c.setPromoDiscount(0);
                  c.setPromoMsg('');
                }}
                onBlur={c.checkPromo}
                placeholder="код"
                className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-right uppercase"
              />
              <button
                onClick={c.checkPromo}
                aria-label="Применить промокод"
                className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200"
              >
                ✓
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowPromo(true)}
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              Добавить
            </button>
          )}
        </div>
        {c.promoMsg && (
          <div
            className={`text-right text-xs ${
              c.promoDiscount > 0 ? 'text-emerald-600' : 'text-rose-500'
            }`}
          >
            {c.promoMsg}
          </div>
        )}
        </>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-base font-semibold text-slate-800">Итого</span>
        <span className="text-2xl font-bold text-slate-900">
          {c.money(c.total)}
        </span>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          Способ оплаты
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {c.methods
            .filter((m) => m.k !== 'DEBT' || c.debtEnabled)
            .map((m) => (
              <button
                key={m.k}
                onClick={() => c.setMethod(m.k)}
                className={`rounded-lg py-2 text-xs font-medium transition ${
                  c.method === m.k
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {m.l}
              </button>
            ))}
        </div>

        {/* Наличные → ввод суммы и сдача в окне по кнопке «Оплатить» */}
        {c.method === 'CASH' && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            Нажмите «Оплатить» — откроется окно для суммы от клиента и расчёта сдачи.
          </p>
        )}

        {/* Смешанная → суммы по способам */}
        {c.isMixed && (
          <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
            {c.splitMethods.map((m) => (
              <div key={m.k} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{m.l}</span>
                <input
                  value={c.splitAmounts[m.k] ?? ''}
                  onChange={(e) => c.setSplitAmounts((s) => ({ ...s, [m.k]: e.target.value }))}
                  type="number"
                  placeholder="0"
                  className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-right dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-slate-200 pt-1 text-sm dark:border-slate-700">
              <span className="text-slate-500">Осталось</span>
              <span className={`font-semibold ${c.splitLeft === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {c.money(c.splitLeft)}
              </span>
            </div>
          </div>
        )}

        {/* В долг — клиент выбирается в отдельном окне */}
        {c.method === 'DEBT' && (
          <div className="mt-3 space-y-2 rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Заказ запишется <b>в долг</b> — укажите клиента, кому даём.
            </p>
            {c.phone ? (
              <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm dark:bg-slate-800">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {c.clientName || 'Клиент'} · {c.phone}
                </span>
                <button
                  onClick={() => { c.setPhone(''); c.setClientName(''); setPickedClient(null); }}
                  className="text-xs text-rose-500 hover:text-rose-600"
                >
                  Сменить
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setClientQuery(''); setClientResults([]); setNewClientPhone(''); setNewClientName(''); setShowClientPicker(true); }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50 dark:border-amber-500/40 dark:bg-slate-800 dark:text-amber-300"
              >
                <IcoPlus className="h-4 w-4" /> Выбрать клиента
              </button>
            )}
          </div>
        )}

        {/* Перевод — QR показывается на ЭКРАНЕ ПОКУПАТЕЛЯ (второй экран), не в корзине */}
        {c.method === 'TRANSFER' && (
          <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
            {c.transferQr || c.transferRequisite ? (
              <>
                QR для перевода показан на <b>экране покупателя</b> — клиент сканирует и переводит {c.money(c.total)}.
                {c.transferRequisite && (
                  <div className="mt-1 font-mono text-slate-600 dark:text-slate-300">{c.transferRequisite}</div>
                )}
                <div className="mt-1 text-[11px] text-sky-600/80">
                  Нет второго экрана? Откройте его кнопкой «Экран покупателя» вверху кассы.
                </div>
              </>
            ) : (
              'Загрузите QR для перевода в «Настройки → Оплата» — он появится на экране покупателя.'
            )}
          </div>
        )}
      </div>

      <button
        onClick={() => {
          if (c.method === 'CASH') {
            c.setCashReceived('');
            setShowCashPay(true);
          } else {
            c.pay();
          }
        }}
        disabled={
          c.cart.length === 0 ||
          (c.isMixed && c.splitLeft !== 0) ||
          (c.method === 'DEBT' && !c.phone.trim())
        }
        className="mt-4 flex w-full items-center justify-between rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        <span>{c.method === 'DEBT' ? 'Записать в долг' : `Оплатить ${c.money(c.total)}`}</span>
        <span className="text-xs opacity-70">F2</span>
      </button>
      <button
        onClick={() => {
          // «Сохранить заказ» проводит ту же продажу, что и «Оплатить»:
          // для наличных открываем окно расчёта сдачи (не пропускаем flow сдачи).
          if (c.method === 'CASH') {
            c.setCashReceived('');
            setShowCashPay(true);
          } else {
            c.pay();
          }
        }}
        disabled={
          c.cart.length === 0 ||
          (c.isMixed && c.splitLeft !== 0) ||
          (c.method === 'DEBT' && !c.phone.trim())
        }
        className="mt-2 flex w-full items-center justify-between rounded-xl border border-slate-200 px-5 py-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
      >
        <span>Сохранить заказ</span>
        <span className="text-xs text-slate-400">F3</span>
      </button>
      {c.msg && <p className="mt-2 text-sm text-rose-600">{c.msg}</p>}

      {/* ====== Окно выбора клиента для долга ====== */}
      {showClientPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowClientPicker(false)} />
          <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Клиент для долга</h3>
              <button onClick={() => setShowClientPicker(false)} aria-label="Закрыть" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>

            <input
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
              autoFocus
              placeholder="Поиск по имени или телефону…"
              className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
            <div className="mb-4 max-h-56 flex-1 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              {visibleClientResults.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">
                  {clientQuery.trim().length < 2 ? 'Введите имя или телефон' : 'Ничего не найдено'}
                </div>
              ) : (
                visibleClientResults.map((cl) => (
                  <button
                    key={cl.id}
                    onClick={() => {
                      c.setPhone(cl.phone);
                      c.setClientName(cl.fullName ?? '');
                      setPickedClient(cl);
                      setShowClientPicker(false);
                      setClientQuery('');
                      setClientResults([]);
                    }}
                    className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                  >
                    <span className="font-medium text-slate-700 dark:text-slate-200">{cl.fullName ?? 'Без имени'}</span>
                    <span className="text-xs text-slate-400">{cl.phone}</span>
                  </button>
                ))
              )}
            </div>

            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Новый клиент</div>
              <div className="flex gap-2">
                <input
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                  placeholder="Телефон"
                  className="w-1/2 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
                <input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Имя"
                  className="w-1/2 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
              <button
                onClick={() => {
                  if (!newClientPhone.trim()) return;
                  c.setPhone(newClientPhone.trim());
                  c.setClientName(newClientName.trim());
                  setPickedClient(null);
                  setShowClientPicker(false);
                }}
                disabled={!newClientPhone.trim()}
                className="mt-2 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                Дать в долг этому клиенту
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== Окно оплаты наличными: получено + сдача ====== */}
      {showCashPay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowCashPay(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Оплата наличными</h3>
              <button onClick={() => setShowCashPay(false)} aria-label="Закрыть" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>

            <div className="mb-4 rounded-xl bg-slate-50 p-4 text-center dark:bg-slate-800/50">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">К оплате</div>
              <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">{c.money(c.total)}</div>
            </div>

            <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Получено от клиента</label>
            <input
              value={c.cashReceived}
              onChange={(e) => c.setCashReceived(e.target.value)}
              type="number"
              inputMode="decimal"
              autoFocus
              placeholder={String(c.total)}
              className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-right text-2xl font-semibold outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="mb-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => c.setCashReceived(String(c.total))} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">Без сдачи</button>
              {cashSuggest.map((v) => (
                <button key={v} type="button" onClick={() => c.setCashReceived(String(v))} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">{c.money(v)}</button>
              ))}
            </div>

            <div className="mb-4 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 dark:bg-emerald-500/10">
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Сдача</span>
              <span className={`text-2xl font-bold ${c.change < 0 ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-300'}`}>
                {c.cashReceived ? c.money(c.change) : '—'}
              </span>
            </div>
            {c.cashReceived && c.change < 0 && (
              <p className="-mt-2 mb-3 text-sm text-rose-500">Не хватает {c.money(-c.change)}</p>
            )}

            <button
              onClick={() => { setShowCashPay(false); c.pay(); }}
              disabled={!!c.cashReceived && c.change < 0}
              className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              Подтвердить оплату
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SkinShop: FC<{ ctx: PosCtx }> = ({ ctx }) => {
  const c = ctx;
  const { items, allCats } = useCombined(c);
  const [activeCat, setActiveCat] = useState('ALL');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [q, setQ] = useState('');

  const countFor = (catId: string) => {
    const set = catWithDescendants(allCats, catId);
    return items.filter((i) => set.has(i.categoryId)).length;
  };
  const activeCatSet =
    activeCat === 'ALL' ? null : catWithDescendants(allCats, activeCat);
  const ql = q.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (!activeCatSet || activeCatSet.has(i.categoryId)) &&
      (!ql ||
        String(i.name ?? '').toLowerCase().includes(ql) ||
        String(i.sku ?? '').toLowerCase().includes(ql) ||
        String(i.barcode ?? '').includes(ql)),
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex gap-6 border-b border-slate-100 text-sm font-medium">
            <span className="-mb-px border-b-2 border-indigo-600 pb-2 text-indigo-600">
              Товары и услуги
            </span>
            <span className="pb-2 text-slate-400">Популярное</span>
            <span className="pb-2 text-slate-400">Недавние</span>
          </div>

          <div className="grid gap-4 md:grid-cols-[180px_1fr]">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Категории
              </div>
              <div className="space-y-0.5">
                <CatRow
                  label="Все товары"
                  count={items.length}
                  active={activeCat === 'ALL'}
                  onClick={() => setActiveCat('ALL')}
                />
                {allCats.map((cat) => (
                  <CatRow
                    key={cat.id}
                    label={cat.name}
                    count={countFor(cat.id)}
                    active={activeCat === cat.id}
                    onClick={() => setActiveCat(cat.id)}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700">
                  <IcoSearch className="h-4 w-4 text-slate-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter = штрихкод: если код точно совпал — товар уйдёт в корзину,
                      // поле очистим. Обычный ввод текста просто фильтрует список ниже.
                      if (e.key === 'Enter' && q.trim()) {
                        c.scan(q.trim());
                        setQ('');
                      }
                    }}
                    placeholder="Поиск товара или услуги · или штрихкод"
                    aria-label="Поиск товара или услуги, или штрихкод"
                    className="w-full bg-transparent text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
                  />
                  {q && (
                    <button
                      type="button"
                      aria-label="Очистить поиск"
                      onClick={() => setQ('')}
                      className="text-lg leading-none text-slate-400 hover:text-slate-600"
                    >
                      ×
                    </button>
                  )}
                  {c.scanMsg && <span className="whitespace-nowrap text-xs text-slate-400">{c.scanMsg}</span>}
                </div>
                <div className="flex gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
                  <button
                    onClick={() => setView('grid')}
                    aria-label="Сетка"
                    className={`flex h-7 w-7 items-center justify-center rounded transition ${
                      view === 'grid'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <IcoGrid className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setView('list')}
                    aria-label="Список"
                    className={`flex h-7 w-7 items-center justify-center rounded transition ${
                      view === 'list'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <IcoList className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {view === 'grid' ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {shown.map((it) => (
                    <button
                      key={`${it._type}:${it.id}`}
                      onClick={() => c.addItem(it, it._type)}
                      className="group overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:border-slate-700/60"
                    >
                      <div className="relative flex h-24 items-center justify-center">
                        <Thumb name={it.name} src={it.imageUrl} className="h-full w-full rounded-none text-3xl" />
                        <span className="absolute right-2 top-2 text-amber-400">
                          <IcoStar className="h-4 w-4" />
                        </span>
                      </div>
                      <div className="p-3">
                        <div className="line-clamp-1 text-sm font-medium text-slate-800 dark:text-slate-200">
                          {it.name}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                          от {c.money(c.priceOf(it, it._type))}
                        </div>
                      </div>
                    </button>
                  ))}
                  <div className="flex min-h-[140px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-3 text-center text-slate-400 dark:border-slate-700">
                    <IcoPlus className="h-6 w-6" />
                    <div className="mt-1 text-sm font-medium">Быстрый товар</div>
                    <div className="text-xs">Добавить без карточки</div>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {shown.map((it) => (
                    <button
                      key={`${it._type}:${it.id}`}
                      onClick={() => c.addItem(it, it._type)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
                    >
                      <Thumb name={it.name} src={it.imageUrl} className="h-9 w-9 rounded-lg text-xs" />
                      <span className="flex-1 text-sm font-medium text-slate-800">
                        {it.name}
                      </span>
                      <span className="text-sm text-slate-500">
                        от {c.money(c.priceOf(it, it._type))}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {shown.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-400">
                  Нет позиций
                </p>
              )}
            </div>
          </div>
        </div>

        {c.recentOrders.length > 0 && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700">Недавние заказы</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {c.recentOrders.map((o) => (
                <div key={o.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-medium text-indigo-600">
                    Заказ {o.orderNumber}
                  </div>
                  <div className="mt-1 truncate text-sm font-medium text-slate-800">
                    {o.client?.fullName ?? 'Без клиента'}
                  </div>
                  <div className="text-sm text-slate-500">
                    {c.money(Number(o.total))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <ActionTile
            icon={<IcoPercent className="h-5 w-5" />}
            tone="violet"
            label="Скидка"
            onClick={() => {
              const v = window.prompt('Скидка, сум:', c.discount);
              if (v !== null) c.setDiscount(v);
            }}
          />
          <ActionTile
            icon={<IcoUser className="h-5 w-5" />}
            tone="indigo"
            label="Клиент"
            onClick={() => {
              const v = window.prompt('Телефон клиента:', c.phone);
              if (v !== null) c.setPhone(v);
            }}
          />
          <ActionTile icon={<IcoComment className="h-5 w-5" />} tone="sky" label="Комментарий" onClick={() => {}} />
          <ActionTile icon={<IcoPause className="h-5 w-5" />} tone="amber" label="Отложить" onClick={c.hold} />
          <ActionTile icon={<IcoTrash className="h-5 w-5" />} tone="rose" label="Очистить" onClick={c.clearCart} />
        </div>
      </div>

      <OrderPanelShop ctx={c} />
    </div>
  );
};

// =====================================================================
// Скин «Прайс-лист» (Дизайн 2, карточки + таблица заказа)
// =====================================================================
function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? 'bg-indigo-600 text-white'
          : 'bg-white text-slate-600 shadow-sm hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'indigo' | 'sky' | 'emerald' | 'rose';
}) {
  const tones: Record<string, string> = {
    indigo: 'text-indigo-600',
    sky: 'text-sky-600',
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
  };
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

function OrderPanelPro({ ctx }: { ctx: PosCtx }) {
  const c = ctx;
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm xl:sticky xl:top-4 xl:self-start">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Текущий заказ</h2>
        <span className="text-sm text-slate-400">{c.cartCount} поз.</span>
      </div>

      {c.cart.length === 0 ? (
        <div className="py-12 text-center">
          <div className="mb-2 flex justify-center text-slate-300"><IcoReceipt className="h-9 w-9" /></div>
          <p className="text-sm text-slate-400">Добавьте услуги или материалы</p>
        </div>
      ) : (
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="py-1.5">Услуга / Материал</th>
              <th className="text-center">Кол-во</th>
              <th className="text-right">Цена</th>
              <th className="text-right">Сумма</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {c.cart.map((item) => (
              <tr key={item.key} className="border-b border-slate-50">
                <td className="py-2 pr-2 font-medium text-slate-700">
                  {item.name}
                </td>
                <td className="text-center">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => c.setQty(item.key, item.quantity - 1)}
                      aria-label="Убрать"
                      className="h-5 w-5 rounded bg-slate-100 text-xs"
                    >
                      −
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      onClick={() => c.setQty(item.key, item.quantity + 1)}
                      aria-label="Добавить"
                      className="h-5 w-5 rounded bg-slate-100 text-xs"
                    >
                      +
                    </button>
                  </div>
                </td>
                <td className="text-right text-slate-500">
                  {Number(item.unitPrice).toFixed(2)}
                </td>
                <td className="text-right font-medium">
                  {Number(item.unitPrice * item.quantity).toFixed(2)}
                </td>
                <td className="pl-1 text-right">
                  <button
                    onClick={() => c.setQty(item.key, 0)}
                    aria-label="Удалить"
                    className="text-slate-300 hover:text-rose-500"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mb-3 rounded-xl border-2 border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">
        Перетащите файл макета или нажмите для загрузки
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Скидка</span>
          <input
            value={c.discount}
            onChange={(e) => c.setDiscount(e.target.value)}
            type="number"
            min="0"
            placeholder="0"
            className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-right"
          />
        </div>
        <Row label="Сумма" value={c.money(c.subtotal)} muted />
        {c.disc > 0 && <Row label="Скидка" value={`− ${c.money(c.disc)}`} muted />}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-base font-semibold text-slate-800">К оплате:</span>
        <span className="text-2xl font-bold text-indigo-600">
          {c.money(c.total)}
        </span>
      </div>

      <button
        onClick={c.pay}
        disabled={c.cart.length === 0}
        className="mt-4 flex w-full items-center justify-between rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        <span>Оплата</span>
        <span className="text-xs opacity-70">F9</span>
      </button>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => c.payWith('CARD')}
          disabled={c.cart.length === 0}
          className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <span>Оплата картой</span>
          <span className="text-xs text-slate-400">F10</span>
        </button>
        <button
          onClick={() => c.setSplit(!c.split)}
          className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
            c.split
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
              : 'border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <span>Смешанная</span>
          <span className="text-xs text-slate-400">F11</span>
        </button>
      </div>

      {c.split && (
        <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3">
          {c.splitMethods.map((m) => (
            <div key={m.k} className="flex items-center gap-2">
              <span className="w-20 text-xs text-slate-600">{m.l}</span>
              <input
                value={c.splitAmounts[m.k] ?? ''}
                onChange={(e) =>
                  c.setSplitAmounts((s) => ({ ...s, [m.k]: e.target.value }))
                }
                type="number"
                min="0"
                placeholder="0"
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm"
              />
            </div>
          ))}
          <div
            className={`flex justify-between text-xs ${
              c.splitLeft === 0 ? 'text-emerald-600' : 'text-amber-600'
            }`}
          >
            <span>Распределено: {c.money(c.splitSum)}</span>
            <span>Осталось: {c.money(c.splitLeft)}</span>
          </div>
          <button
            onClick={() => c.payWith('MIXED')}
            disabled={c.cart.length === 0 || c.splitLeft !== 0}
            className="mt-1 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Провести смешанную оплату
          </button>
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={c.hold} className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-50">
          Отложить <span className="text-xs">F5</span>
        </button>
        <button
          onClick={c.clearCart}
          className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-50"
        >
          Очистить <span className="text-xs">F7</span>
        </button>
      </div>

      {c.msg && <p className="mt-2 text-sm text-rose-600">{c.msg}</p>}

      <div className="mt-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 p-3 text-xs text-white">
        🎁 Скидка 10% на широкоформатную печать. Только до конца месяца!
      </div>
    </div>
  );
}

const SkinPro: FC<{ ctx: PosCtx }> = ({ ctx }) => {
  const c = ctx;
  const { items, allCats } = useCombined(c);
  const [activeCat, setActiveCat] = useState('ALL');
  const activeCatSet =
    activeCat === 'ALL' ? null : catWithDescendants(allCats, activeCat);
  const shown = items.filter(
    (i) => !activeCatSet || activeCatSet.has(i.categoryId),
  );
  const quick = c.services.slice(0, 5);

  const subOf = (it: any) =>
    it._type === 'SERVICE'
      ? it.category?.name ?? 'Услуга'
      : it.unit?.shortName
        ? `ед.: ${it.unit.shortName}`
        : it.category?.name ?? 'Товар';

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Chip
            label="Все услуги"
            active={activeCat === 'ALL'}
            onClick={() => setActiveCat('ALL')}
          />
          {allCats.map((cat) => (
            <Chip
              key={cat.id}
              label={cat.name}
              active={activeCat === cat.id}
              onClick={() => setActiveCat(cat.id)}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {shown.map((it) => (
            <button
              key={`${it._type}:${it.id}`}
              onClick={() => c.addItem(it, it._type)}
              className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md"
            >
              <div
                className={`flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br ${tileGrad(
                  it.name,
                )} text-3xl font-bold text-white/90`}
              >
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(it.imageUrl)} alt={it.name} className="h-full w-full object-cover" />
                ) : (
                  initial(it.name)
                )}
              </div>
              <div className="p-3">
                <div className="text-sm font-semibold text-slate-800">
                  {it.name}
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">
                  {subOf(it)}
                </div>
                <div className="mt-2 text-sm font-bold text-indigo-600">
                  от {c.money(c.priceOf(it, it._type))}
                </div>
              </div>
            </button>
          ))}
          {shown.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-slate-400">
              Нет позиций
            </p>
          )}
        </div>

        {quick.length > 0 && (
          <div>
            <div className="mb-2 text-sm font-semibold text-slate-600">
              Быстрые услуги
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {quick.map((s) => (
                <button
                  key={s.id}
                  onClick={() => c.addItem(s, 'SERVICE')}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-left text-sm shadow-sm transition hover:border-indigo-300"
                >
                  <div className="line-clamp-1 font-medium text-slate-700">
                    {s.name}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    от {c.money(c.priceOf(s, 'SERVICE'))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat label="Активные заказы" value={c.orderStats.active} tone="indigo" />
          <Stat label="Заказы в работе" value={c.orderStats.inWork} tone="sky" />
          <Stat label="Готовые заказы" value={c.orderStats.ready} tone="emerald" />
          <Stat label="Просроченные" value={c.orderStats.overdue} tone="rose" />
        </div>
      </div>

      <OrderPanelPro ctx={c} />
    </div>
  );
};

// =====================================================================
// Скин «Простой» (минимальный — плитка + чек справа)
// =====================================================================
const SkinClassic: FC<{ ctx: PosCtx }> = ({ ctx }) => {
  const c = ctx;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
          {(['SERVICE', 'PRODUCT'] as const).map((t) => (
            <button
              key={t}
              onClick={() => c.switchTab(t)}
              className={`rounded-lg py-2.5 text-sm font-semibold transition ${
                c.tab === t
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'SERVICE' ? 'Услуги' : 'Товары'}
            </button>
          ))}
        </div>

        <div className="relative mb-3">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <IcoSearch className="h-4 w-4" />
          </span>
          <input
            value={c.search}
            onChange={(e) => c.setSearch(e.target.value)}
            placeholder={c.tab === 'SERVICE' ? 'Поиск услуги…' : 'Поиск товара…'}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm focus:border-indigo-400 focus:bg-white focus:outline-none"
          />
        </div>

        {c.cats.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              onClick={() => c.setCatFilter('ALL')}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                c.catFilter === 'ALL'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Все
            </button>
            {c.cats.map((cat) => (
              <button
                key={cat.id}
                onClick={() => c.setCatFilter(cat.id)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  c.catFilter === cat.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {c.filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => c.addItem(item, c.tab)}
              className="group flex min-h-[88px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-md active:translate-y-0"
            >
              <div className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">
                {item.name}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-semibold text-indigo-600">
                  {c.money(c.priceOf(item, c.tab))}
                </span>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition group-hover:bg-indigo-600 group-hover:text-white">
                  +
                </span>
              </div>
            </button>
          ))}
          {c.filtered.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-slate-400">
              Ничего не найдено
            </p>
          )}
        </div>
      </div>

      <OrderPanelShop ctx={c} />
    </div>
  );
};

// =====================================================================
// Скин «Каталог» (Дизайн 3): фото-плитки + чек с разделением услуги/материалы,
// скидка в % или сумме.
// =====================================================================
function OrderPanelMarket({ ctx }: { ctx: PosCtx }) {
  const c = ctx;
  const [discMode, setDiscMode] = useState<'percent' | 'amount'>('percent');
  const [pct, setPct] = useState('');

  const servicesSum = c.cart
    .filter((i) => i.itemType === 'SERVICE')
    .reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const materialsSum = c.cart
    .filter((i) => i.itemType === 'PRODUCT')
    .reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  // В режиме «%» пересчитываем абсолютную скидку из процента и суммы заказа.
  useEffect(() => {
    if (discMode !== 'percent') return;
    const abs = Number(((c.subtotal * (Number(pct) || 0)) / 100).toFixed(2));
    c.setDiscount(String(abs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discMode, pct, c.subtotal]);

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm xl:sticky xl:top-4 xl:self-start">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Текущий заказ</h2>
        <span className="text-sm text-slate-400">{c.cartCount} поз.</span>
      </div>

      {c.cart.length === 0 ? (
        <div className="py-12 text-center">
          <div className="mb-2 flex justify-center text-slate-300"><IcoReceipt className="h-9 w-9" /></div>
          <p className="text-sm text-slate-400">Добавьте услуги или материалы</p>
        </div>
      ) : (
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="py-1.5">Услуга / Материал</th>
              <th className="text-center">Кол-во</th>
              <th className="text-right">Цена</th>
              <th className="text-right">Сумма</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {c.cart.map((item) => (
              <tr key={item.key} className="border-b border-slate-50">
                <td className="py-2 pr-2 font-medium text-slate-700">
                  {item.name}
                </td>
                <td className="text-center">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => c.setQty(item.key, item.quantity - 1)}
                      aria-label="Убрать"
                      className="h-5 w-5 rounded bg-slate-100 text-xs"
                    >
                      −
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      onClick={() => c.setQty(item.key, item.quantity + 1)}
                      aria-label="Добавить"
                      className="h-5 w-5 rounded bg-slate-100 text-xs"
                    >
                      +
                    </button>
                  </div>
                </td>
                <td className="text-right text-slate-500">
                  {Number(item.unitPrice).toFixed(2)}
                </td>
                <td className="text-right font-medium">
                  {Number(item.unitPrice * item.quantity).toFixed(2)}
                </td>
                <td className="pl-1 text-right">
                  <button
                    onClick={() => c.setQty(item.key, 0)}
                    aria-label="Удалить"
                    className="text-slate-300 hover:text-rose-500"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mb-3 rounded-xl border-2 border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">
        Перетащите файл макета или нажмите для загрузки
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Скидка</span>
          <div className="flex items-center gap-1.5">
            <select
              value={discMode}
              onChange={(e) => setDiscMode(e.target.value as 'percent' | 'amount')}
              className="rounded-lg border border-slate-200 px-1.5 py-1 text-sm"
            >
              <option value="percent">%</option>
              <option value="amount">сумма</option>
            </select>
            {discMode === 'percent' ? (
              <input
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                type="number"
                min="0"
                max="100"
                placeholder="0"
                className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right"
              />
            ) : (
              <input
                value={c.discount}
                onChange={(e) => c.setDiscount(e.target.value)}
                type="number"
                min="0"
                placeholder="0"
                className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right"
              />
            )}
          </div>
        </div>
        <Row label="Итого услуг" value={c.money(servicesSum)} muted />
        <Row label="Итого материалов" value={c.money(materialsSum)} muted />
        {c.disc > 0 && <Row label="Скидка" value={`− ${c.money(c.disc)}`} muted />}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-base font-semibold text-slate-800">К оплате:</span>
        <span className="text-2xl font-bold text-indigo-600">
          {c.money(c.total)}
        </span>
      </div>

      <button
        onClick={c.pay}
        disabled={c.cart.length === 0}
        className="mt-4 flex w-full items-center justify-between rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        <span>Оплата</span>
        <span className="text-xs opacity-70">F9</span>
      </button>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => c.payWith('CARD')}
          disabled={c.cart.length === 0}
          className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <span>Оплата картой</span>
          <span className="text-xs text-slate-400">F10</span>
        </button>
        <button
          onClick={() => c.setSplit(!c.split)}
          className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
            c.split
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
              : 'border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <span>Смешанная</span>
          <span className="text-xs text-slate-400">F11</span>
        </button>
      </div>

      {c.split && (
        <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3">
          {c.splitMethods.map((m) => (
            <div key={m.k} className="flex items-center gap-2">
              <span className="w-20 text-xs text-slate-600">{m.l}</span>
              <input
                value={c.splitAmounts[m.k] ?? ''}
                onChange={(e) =>
                  c.setSplitAmounts((s) => ({ ...s, [m.k]: e.target.value }))
                }
                type="number"
                min="0"
                placeholder="0"
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm"
              />
            </div>
          ))}
          <div
            className={`flex justify-between text-xs ${
              c.splitLeft === 0 ? 'text-emerald-600' : 'text-amber-600'
            }`}
          >
            <span>Распределено: {c.money(c.splitSum)}</span>
            <span>Осталось: {c.money(c.splitLeft)}</span>
          </div>
          <button
            onClick={() => c.payWith('MIXED')}
            disabled={c.cart.length === 0 || c.splitLeft !== 0}
            className="mt-1 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Провести смешанную оплату
          </button>
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={c.hold} className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-50">
          Отложить <span className="text-xs">F5</span>
        </button>
        <button
          onClick={c.clearCart}
          className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-50"
        >
          Очистить <span className="text-xs">F7</span>
        </button>
      </div>

      {c.msg && <p className="mt-2 text-sm text-rose-600">{c.msg}</p>}

      <div className="mt-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 p-3 text-xs text-white">
        🎁 Скидка 10% на широкоформатную печать. Только до конца месяца!
      </div>
    </div>
  );
}

const SkinMarket: FC<{ ctx: PosCtx }> = ({ ctx }) => {
  const c = ctx;
  const { items, allCats } = useCombined(c);
  const [activeCat, setActiveCat] = useState('ALL');
  const activeCatSet =
    activeCat === 'ALL' ? null : catWithDescendants(allCats, activeCat);
  const shown = items.filter(
    (i) => !activeCatSet || activeCatSet.has(i.categoryId),
  );
  const quick = c.services.slice(0, 5);

  const subOf = (it: any) =>
    it._type === 'SERVICE'
      ? it.category?.name ?? 'Услуга'
      : it.unit?.shortName
        ? `ед.: ${it.unit.shortName}`
        : it.category?.name ?? 'Товар';

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Chip
            label="Все услуги"
            active={activeCat === 'ALL'}
            onClick={() => setActiveCat('ALL')}
          />
          {allCats.map((cat) => (
            <Chip
              key={cat.id}
              label={cat.name}
              active={activeCat === cat.id}
              onClick={() => setActiveCat(cat.id)}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {shown.map((it) => (
            <button
              key={`${it._type}:${it.id}`}
              onClick={() => c.addItem(it, it._type)}
              className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
            >
              <div
                className={`flex h-32 items-center justify-center bg-gradient-to-br ${tileGrad(
                  it.name,
                )} text-4xl font-bold text-white/90`}
              >
                {initial(it.name)}
              </div>
              <div className="p-3">
                <div className="text-sm font-semibold text-slate-800">
                  {it.name}
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">
                  {it.description || subOf(it)}
                </div>
                <div className="mt-2 text-sm font-bold text-indigo-600">
                  от {c.money(c.priceOf(it, it._type))}
                </div>
              </div>
            </button>
          ))}
          {shown.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-slate-400">
              Нет позиций
            </p>
          )}
        </div>

        {quick.length > 0 && (
          <div>
            <div className="mb-2 text-sm font-semibold text-slate-600">
              Быстрые услуги
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {quick.map((s) => (
                <button
                  key={s.id}
                  onClick={() => c.addItem(s, 'SERVICE')}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-left text-sm shadow-sm transition hover:border-indigo-300"
                >
                  <div className="line-clamp-1 font-medium text-slate-700">
                    {s.name}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    от {c.money(c.priceOf(s, 'SERVICE'))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat label="Активные заказы" value={c.orderStats.active} tone="indigo" />
          <Stat label="Заказы в работе" value={c.orderStats.inWork} tone="sky" />
          <Stat label="Готовые заказы" value={c.orderStats.ready} tone="emerald" />
          <Stat label="Просроченные" value={c.orderStats.overdue} tone="rose" />
        </div>
      </div>

      <OrderPanelMarket ctx={c} />
    </div>
  );
};

// ===== Реестр скинов: ключ настройки → компонент =====
export const SKINS: Record<string, FC<{ ctx: PosCtx }>> = {
  prime: SkinPrime,
  shop: SkinShop,
  pro: SkinPro,
  classic: SkinClassic,
  market: SkinMarket,
};
