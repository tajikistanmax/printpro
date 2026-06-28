'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction, FC } from 'react';

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
  method: string;
  setMethod: Dispatch<SetStateAction<string>>;
  methods: PosMethod[];
  split: boolean;
  setSplit: Dispatch<SetStateAction<boolean>>;
  splitAmounts: Record<string, string>;
  setSplitAmounts: Dispatch<SetStateAction<Record<string, string>>>;
  splitSum: number;
  splitLeft: number;
  pay: () => void;
  payWith: (method: string) => void;
  msg: string;
  // для богатых оформлений
  recentOrders: any[];
  orderStats: OrderStats;
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
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition ${
        active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-white'
      }`}
    >
      <span className="truncate">{label}</span>
      <span
        className={`ml-2 text-xs ${active ? 'text-white/80' : 'text-slate-400'}`}
      >
        {count}
      </span>
    </button>
  );
}

function ActionTile({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-2xl bg-white py-4 text-sm text-slate-600 shadow-sm transition hover:shadow-md"
    >
      <span className="text-xl">{icon}</span>
      {label}
    </button>
  );
}

function OrderPanelShop({ ctx }: { ctx: PosCtx }) {
  const c = ctx;
  const [showPromo, setShowPromo] = useState(false);
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm xl:sticky xl:top-4 xl:self-start">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Текущий заказ</h2>
        <span className="text-sm text-slate-400">{c.cartCount} поз.</span>
      </div>

      {c.cart.length === 0 ? (
        <div className="py-12 text-center">
          <div className="mb-2 text-3xl">🧾</div>
          <p className="text-sm text-slate-400">Добавьте товары и услуги</p>
        </div>
      ) : (
        <div className="mb-4 max-h-[44vh] space-y-3 overflow-auto pr-1">
          {c.cart.map((item) => (
            <div key={item.key} className="flex gap-3">
              <div
                className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${tileGrad(
                  item.name,
                )} text-sm font-bold text-white/90`}
              >
                {initial(item.name)}
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium text-slate-800">
                    {item.name}
                  </div>
                  <div className="whitespace-nowrap text-sm font-semibold text-slate-800">
                    {c.money(item.unitPrice * item.quantity)}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => c.setQty(item.key, item.quantity - 1)}
                      className="h-6 w-6 rounded bg-slate-100 text-slate-600"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => c.setQty(item.key, item.quantity + 1)}
                      className="h-6 w-6 rounded bg-slate-100 text-slate-600"
                    >
                      +
                    </button>
                  </div>
                  <button
                    onClick={() => c.setQty(item.key, 0)}
                    className="text-slate-300 transition hover:text-rose-500"
                    title="Убрать"
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="mb-4 w-full rounded-xl border-2 border-dashed border-slate-200 py-2.5 text-sm text-indigo-600 transition hover:bg-indigo-50">
        ＋ Добавить примечание к заказу
      </button>

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
        <div className="grid grid-cols-4 gap-1.5">
          {c.methods.map((m) => (
            <button
              key={m.k}
              onClick={() => c.setMethod(m.k)}
              className={`rounded-lg py-2 text-xs font-medium transition ${
                c.method === m.k
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {m.l}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={c.pay}
        disabled={c.cart.length === 0}
        className="mt-4 flex w-full items-center justify-between rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        <span>Оплатить {c.money(c.total)}</span>
        <span className="text-xs opacity-70">F2</span>
      </button>
      <button
        onClick={c.pay}
        disabled={c.cart.length === 0}
        className="mt-2 flex w-full items-center justify-between rounded-xl border border-slate-200 px-5 py-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
      >
        <span>Сохранить заказ</span>
        <span className="text-xs text-slate-400">F3</span>
      </button>
      {c.msg && <p className="mt-2 text-sm text-rose-600">{c.msg}</p>}
    </div>
  );
}

const SkinShop: FC<{ ctx: PosCtx }> = ({ ctx }) => {
  const c = ctx;
  const { items, allCats } = useCombined(c);
  const [activeCat, setActiveCat] = useState('ALL');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const countFor = (catId: string) =>
    items.filter((i) => i.categoryId === catId).length;
  const shown = items.filter(
    (i) => activeCat === 'ALL' || i.categoryId === activeCat,
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
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500">
                  ▢ Сканировать штрихкод
                </span>
                <div className="flex gap-1 rounded-lg border border-slate-200 p-0.5">
                  <button
                    onClick={() => setView('grid')}
                    className={`rounded px-2 py-1 text-sm ${
                      view === 'grid'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-500'
                    }`}
                  >
                    ▦
                  </button>
                  <button
                    onClick={() => setView('list')}
                    className={`rounded px-2 py-1 text-sm ${
                      view === 'list'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-500'
                    }`}
                  >
                    ≣
                  </button>
                </div>
              </div>

              {view === 'grid' ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {shown.map((it) => (
                    <button
                      key={`${it._type}:${it.id}`}
                      onClick={() => c.addItem(it, it._type)}
                      className="group overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition hover:border-indigo-300 hover:shadow-md"
                    >
                      <div
                        className={`relative flex h-24 items-center justify-center bg-gradient-to-br ${tileGrad(
                          it.name,
                        )} text-2xl font-bold text-white/90`}
                      >
                        {initial(it.name)}
                        <span className="absolute right-2 top-2 text-amber-300">
                          ★
                        </span>
                      </div>
                      <div className="p-3">
                        <div className="line-clamp-1 text-sm font-medium text-slate-800">
                          {it.name}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          от {c.money(c.priceOf(it, it._type))}
                        </div>
                      </div>
                    </button>
                  ))}
                  <div className="flex min-h-[140px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-3 text-center text-slate-400">
                    <div className="text-2xl">＋</div>
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
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50"
                    >
                      <span className="text-sm font-medium text-slate-800">
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
            icon="％"
            label="Скидка"
            onClick={() => {
              const v = window.prompt('Скидка, сум:', c.discount);
              if (v !== null) c.setDiscount(v);
            }}
          />
          <ActionTile
            icon="👤"
            label="Клиент"
            onClick={() => {
              const v = window.prompt('Телефон клиента:', c.phone);
              if (v !== null) c.setPhone(v);
            }}
          />
          <ActionTile icon="💬" label="Комментарий" onClick={() => {}} />
          <ActionTile icon="⏸" label="Отложить" onClick={() => {}} />
          <ActionTile icon="🗑" label="Очистить" onClick={c.clearCart} />
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
          <div className="mb-2 text-3xl">🧾</div>
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
                      className="h-5 w-5 rounded bg-slate-100 text-xs"
                    >
                      −
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      onClick={() => c.setQty(item.key, item.quantity + 1)}
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
          {c.methods.map((m) => (
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
            onClick={c.pay}
            disabled={c.cart.length === 0}
            className="mt-1 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Провести смешанную оплату
          </button>
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-50">
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
  const shown = items.filter(
    (i) => activeCat === 'ALL' || i.categoryId === activeCat,
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
                className={`flex h-28 items-center justify-center bg-gradient-to-br ${tileGrad(
                  it.name,
                )} text-3xl font-bold text-white/90`}
              >
                {initial(it.name)}
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
            🔍
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
          <div className="mb-2 text-3xl">🧾</div>
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
                      className="h-5 w-5 rounded bg-slate-100 text-xs"
                    >
                      −
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      onClick={() => c.setQty(item.key, item.quantity + 1)}
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
          {c.methods.map((m) => (
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
            onClick={c.pay}
            disabled={c.cart.length === 0}
            className="mt-1 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Провести смешанную оплату
          </button>
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-50">
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
  const shown = items.filter(
    (i) => activeCat === 'ALL' || i.categoryId === activeCat,
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
  shop: SkinShop,
  pro: SkinPro,
  classic: SkinClassic,
  market: SkinMarket,
};
