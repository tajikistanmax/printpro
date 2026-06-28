'use client';

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

export interface PosCtx {
  money: (n: number) => string;
  // каталог
  tab: 'SERVICE' | 'PRODUCT';
  switchTab: (t: 'SERVICE' | 'PRODUCT') => void;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  cats: any[];
  catFilter: string;
  setCatFilter: Dispatch<SetStateAction<string>>;
  filtered: any[];
  priceOf: (item: any) => number;
  addItem: (item: any) => void;
  // корзина
  cart: CartItem[];
  setQty: (key: string, q: number) => void;
  cartCount: number;
  // суммы
  subtotal: number;
  discount: string;
  setDiscount: Dispatch<SetStateAction<string>>;
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
  msg: string;
}

// ===== Заголовок каталога: вкладки + поиск + чипы категорий (общий) =====
function CatalogHeader({ ctx }: { ctx: PosCtx }) {
  const c = ctx;
  return (
    <>
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
    </>
  );
}

// ===== Панель чека / оплаты (общая для скинов) =====
export function CartPanel({ ctx }: { ctx: PosCtx }) {
  const c = ctx;
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm lg:sticky lg:top-4 lg:self-start">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">Чек</h2>
        {c.cartCount > 0 && (
          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-600">
            {c.cartCount} поз.
          </span>
        )}
      </div>

      {c.cart.length === 0 ? (
        <div className="py-10 text-center">
          <div className="mb-2 text-3xl">🧾</div>
          <p className="text-sm text-slate-400">
            Нажмите на услугу или товар, чтобы добавить
          </p>
        </div>
      ) : (
        <div className="mb-3 max-h-[40vh] space-y-2 overflow-auto pr-1">
          {c.cart.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm"
            >
              <div className="flex-1">
                <div className="font-medium text-slate-700">{item.name}</div>
                <div className="text-xs text-slate-400">
                  {c.money(item.unitPrice)} × {item.quantity}
                </div>
              </div>
              <button
                onClick={() => c.setQty(item.key, item.quantity - 1)}
                className="h-7 w-7 rounded-lg bg-white text-slate-600 shadow-sm hover:bg-slate-100"
              >
                −
              </button>
              <span className="w-6 text-center font-medium">{item.quantity}</span>
              <button
                onClick={() => c.setQty(item.key, item.quantity + 1)}
                className="h-7 w-7 rounded-lg bg-white text-slate-600 shadow-sm hover:bg-slate-100"
              >
                +
              </button>
              <span className="w-20 text-right font-semibold text-slate-800">
                {c.money(item.unitPrice * item.quantity)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <input
          value={c.phone}
          onChange={(e) => c.setPhone(e.target.value)}
          placeholder="Телефон клиента (необяз.)"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Подытог</span>
          <span>{c.money(c.subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Скидка</span>
          <input
            value={c.discount}
            onChange={(e) => c.setDiscount(e.target.value)}
            type="number"
            min="0"
            placeholder="0"
            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right"
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-slate-500">Промокод</span>
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
              className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right uppercase"
            />
            <button
              type="button"
              onClick={c.checkPromo}
              className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200"
            >
              ✓
            </button>
          </div>
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
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">🎁 Списать бонусы</span>
          <input
            value={c.useBonus}
            onChange={(e) => c.setUseBonus(e.target.value)}
            type="number"
            min="0"
            placeholder="0"
            title="Не более 30% от суммы; нужен телефон клиента"
            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right"
          />
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-lg font-bold">
          <span>Итого</span>
          <span className="text-indigo-600">{c.money(c.total)}</span>
        </div>

        {!c.split ? (
          <div className="grid grid-cols-4 gap-1.5 pt-1">
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
        ) : (
          <div className="space-y-1.5 pt-1">
            {c.methods.map((m) => (
              <div key={m.k} className="flex items-center gap-2">
                <span className="w-20 text-sm text-slate-600">{m.l}</span>
                <input
                  value={c.splitAmounts[m.k] ?? ''}
                  onChange={(e) =>
                    c.setSplitAmounts((s) => ({ ...s, [m.k]: e.target.value }))
                  }
                  type="number"
                  min="0"
                  placeholder="0"
                  className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
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
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={c.split}
            onChange={(e) => c.setSplit(e.target.checked)}
          />
          Смешанная оплата (несколько способов)
        </label>

        <button
          onClick={c.pay}
          disabled={c.cart.length === 0}
          className="w-full rounded-xl bg-emerald-600 py-3 text-base font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          Оплатить{c.total > 0 ? ` · ${c.money(c.total)}` : ''}
        </button>
        {c.msg && <p className="text-sm text-rose-600">{c.msg}</p>}
      </div>
    </div>
  );
}

// ===== Скин 1: Классический (плитка) =====
const SkinClassic: FC<{ ctx: PosCtx }> = ({ ctx }) => {
  const c = ctx;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <CatalogHeader ctx={c} />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {c.filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => c.addItem(item)}
              className="group flex min-h-[88px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-md active:translate-y-0"
            >
              <div className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">
                {item.name}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-semibold text-indigo-600">
                  {c.money(c.priceOf(item))}
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
      <CartPanel ctx={c} />
    </div>
  );
};

// ===== Скин 2: Компактный (список) =====
const SkinCompact: FC<{ ctx: PosCtx }> = ({ ctx }) => {
  const c = ctx;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <CatalogHeader ctx={c} />
        <div className="divide-y divide-slate-100">
          {c.filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => c.addItem(item)}
              className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left transition hover:bg-indigo-50/60"
            >
              <span className="text-sm font-medium text-slate-800">
                {item.name}
              </span>
              <span className="flex items-center gap-3">
                <span className="font-semibold text-indigo-600">
                  {c.money(c.priceOf(item))}
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  +
                </span>
              </span>
            </button>
          ))}
          {c.filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-400">
              Ничего не найдено
            </p>
          )}
        </div>
      </div>
      <CartPanel ctx={c} />
    </div>
  );
};

// ===== Реестр скинов: ключ настройки → компонент =====
export const SKINS: Record<string, FC<{ ctx: PosCtx }>> = {
  classic: SkinClassic,
  compact: SkinCompact,
};
