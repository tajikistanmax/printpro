'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import { api, fileUrl } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import type { PosCtx } from './_pos';

/* ================================================================== *
 *  Скин кассы «Премиум» — современный терминал продажи.
 *  Слева: крупный поиск, фильтр типа, чипы категорий, фото-плитки.
 *  Справа: корзина с большими кнопками, клиентом, скидками/бонусами
 *  и способами оплаты с иконками. Бизнес-логика — та же, что и в
 *  остальных скинах (тот же PosCtx), изменено только оформление.
 * ================================================================== */

/* ------------------------------ иконки ------------------------------ */
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
const IcoSearch = svg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>);
const IcoReceipt = svg(<>
  <path d="M5 3v18l2-1.2L9 21l2-1.2L13 21l2-1.2L17 21l2 0V3l-2 1.2L15 3l-2 1.2L11 3 9 4.2 7 3Z" />
  <path d="M8 8h8M8 12h8M8 16h5" />
</>);
const IcoTrash = svg(<>
  <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" />
  <path d="M10 11v6M14 11v6" />
</>);
const IcoUser = svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
const IcoPlus = svg(<path d="M12 5v14M5 12h14" />);
const IcoPause = svg(<path d="M9 5v14M15 5v14" />);
const IcoCash = svg(<>
  <rect x="2" y="6" width="20" height="12" rx="2" />
  <circle cx="12" cy="12" r="2.6" />
  <path d="M5.5 9.5h.01M18.5 14.5h.01" />
</>);
const IcoTransfer = svg(<>
  <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
  <rect x="9" y="9" width="6" height="6" rx="1" />
</>);
const IcoSplit = svg(<>
  <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
  <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
  <path d="M12 6v12" />
</>);
const IcoDebt = svg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoNote = svg(<><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12Z" /></>);
const IcoSpark = svg(<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />);

/* --------------------- плитка-миниатюра (фото/инициал) --------------------- */
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
function initial(name: string) {
  const t = (name || '').trim();
  return t ? t[0].toUpperCase() : '?';
}
function Thumb({
  name,
  src,
  className = 'h-12 w-12 rounded-xl text-sm',
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
    <div className={`flex shrink-0 items-center justify-center font-bold ${softTile(name)} ${className}`}>
      {initial(name)}
    </div>
  );
}

/* ============================ Корзина (правая панель) ============================ */
function OrderPanelPrime({ ctx }: { ctx: PosCtx }) {
  const c = ctx;
  const [showNote, setShowNote] = useState(false);
  const [showPromo, setShowPromo] = useState(false);
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

  // Поиск/создание клиента (для бонусов и продажи в долг)
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<any[]>([]);
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientName, setNewClientName] = useState('');
  useEffect(() => {
    if (clientQuery.trim().length < 2) {
      setClientResults([]);
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

  const openClientPicker = () => {
    setClientQuery('');
    setClientResults([]);
    setNewClientPhone('');
    setNewClientName('');
    setShowClientPicker(true);
  };

  const payDisabled =
    c.payBusy ||
    c.cart.length === 0 ||
    (c.isMixed && c.splitLeft !== 0) ||
    (c.method === 'DEBT' && !c.phone.trim());

  const METHOD_ICONS: Record<string, FC<PIcon>> = {
    CASH: IcoCash,
    TRANSFER: IcoTransfer,
    MIXED: IcoSplit,
    DEBT: IcoDebt,
  };

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200/70 bg-white shadow-sm xl:sticky xl:top-4 xl:self-start dark:border-slate-700/60">
      {/* Шапка корзины */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700/60">
        <div className="flex items-center gap-2.5">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Текущий заказ</h2>
          {c.cartCount > 0 && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
              {c.cartCount}
            </span>
          )}
        </div>
        {c.cart.length > 0 && (
          <button
            onClick={c.clearCart}
            title="Очистить корзину"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 dark:text-slate-500 dark:hover:bg-rose-500/10"
          >
            <IcoTrash className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-col p-5">
        {/* Клиент (бонусы / долг) */}
        {c.phone ? (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-indigo-50/70 px-3.5 py-2.5 dark:bg-indigo-500/10">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                {initial(c.clientName || c.phone)}
              </span>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                  {c.clientName || 'Клиент'}
                </div>
                <div className="text-xs text-slate-400">{c.phone}</div>
              </div>
            </div>
            <button
              onClick={() => {
                c.setPhone('');
                c.setClientName('');
                c.setUseBonus('');
              }}
              className="text-xs font-medium text-rose-500 hover:text-rose-600"
            >
              Убрать
            </button>
          </div>
        ) : (
          <button
            onClick={openClientPicker}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-2.5 text-sm font-medium text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400"
          >
            <IcoUser className="h-4 w-4" /> Добавить клиента · бонусы
          </button>
        )}

        {/* Позиции */}
        {c.cart.length === 0 ? (
          <div className="py-10 text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
              <IcoReceipt className="h-7 w-7" />
            </span>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Корзина пуста</p>
            <p className="mt-1 text-xs text-slate-400">Выберите позицию слева или отсканируйте штрихкод</p>
          </div>
        ) : (
          <div className="mb-4 max-h-[38vh] space-y-3 overflow-auto pr-1">
            {c.cart.map((item) => (
              <div key={item.key} className="flex gap-3">
                <Thumb name={item.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{item.name}</div>
                      <div className="text-xs text-slate-400">{c.money(item.unitPrice)} / шт</div>
                    </div>
                    <div className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                      {c.money(item.unitPrice * item.quantity)}
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                      <button
                        onClick={() => c.setQty(item.key, item.quantity - 1)}
                        aria-label="Убрать"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-base font-medium text-slate-600 transition hover:bg-white hover:shadow-sm dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums">{item.quantity}</span>
                      <button
                        onClick={() => c.setQty(item.key, item.quantity + 1)}
                        aria-label="Добавить"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-base font-medium text-slate-600 transition hover:bg-white hover:shadow-sm dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={() => c.setQty(item.key, 0)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 dark:text-slate-500 dark:hover:bg-rose-500/10"
                      title="Убрать позицию"
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

        {/* Скидка / промокод / бонусы */}
        <div className="space-y-2 border-t border-slate-100 pt-3 text-sm dark:border-slate-700/60">
          <div className="flex items-center justify-between text-slate-500">
            <span>Сумма</span>
            <span className="font-medium tabular-nums text-slate-700 dark:text-slate-300">{c.money(c.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Скидка</span>
            <div className="flex items-center gap-2">
              {c.disc > 0 && <span className="text-emerald-600">− {c.money(c.disc)}</span>}
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
                      className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                    >
                      ✓
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setShowPromo(true)} className="font-medium text-indigo-600 hover:text-indigo-700">
                    Добавить
                  </button>
                )}
              </div>
              {c.promoMsg && (
                <div className={`text-right text-xs ${c.promoDiscount > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {c.promoMsg}
                </div>
              )}
            </>
          )}
          {c.phone.trim() && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-500">
                <IcoSpark className="h-4 w-4 text-amber-500" /> Бонусы
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">до 30% чека</span>
                <input
                  value={c.useBonus}
                  onChange={(e) => c.setUseBonus(e.target.value)}
                  type="number"
                  min="0"
                  placeholder="0"
                  className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right"
                />
              </div>
            </div>
          )}
        </div>

        {/* Примечание */}
        {showNote || c.note ? (
          <textarea
            value={c.note}
            onChange={(e) => c.setNote(e.target.value)}
            placeholder="Примечание к заказу…"
            rows={2}
            autoFocus
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          />
        ) : (
          <button
            onClick={() => setShowNote(true)}
            className="mt-3 flex items-center gap-1.5 self-start text-xs font-medium text-slate-400 transition hover:text-indigo-600"
          >
            <IcoNote className="h-3.5 w-3.5" /> Примечание к заказу
          </button>
        )}

        {c.taxAmount > 0 && (
          <div className="mt-2 flex items-center justify-between px-1 text-sm text-slate-500 dark:text-slate-400">
            <span>в т.ч. налог (НДС {c.taxPct}%)</span>
            <span>{c.money(c.taxAmount)}</span>
          </div>
        )}
        {/* Итого */}
        <div className="mt-4 flex items-end justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
          <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Итого</span>
          <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
            {c.money(c.total)}
          </span>
        </div>

        {/* Способ оплаты */}
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Способ оплаты</div>
          <div className="grid grid-cols-2 gap-2">
            {c.methods
              .filter((m) => m.k !== 'DEBT' || c.debtEnabled)
              .map((m) => {
                const Ico = METHOD_ICONS[m.k] ?? IcoCash;
                const active = c.method === m.k;
                return (
                  <button
                    key={m.k}
                    onClick={() => c.setMethod(m.k)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      active
                        ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                        active ? 'bg-white/15' : 'bg-slate-100 dark:bg-slate-800'
                      }`}
                    >
                      <Ico className="h-4 w-4" />
                    </span>
                    {m.l}
                  </button>
                );
              })}
          </div>

          {c.method === 'CASH' && (
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              Нажмите «Оплатить» — откроется окно для суммы от клиента и расчёта сдачи.
            </p>
          )}

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

          {c.method === 'DEBT' && (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Заказ запишется <b>в долг</b>{' '}
                {c.phone
                  ? `клиенту ${c.clientName || c.phone}.`
                  : '— добавьте клиента (кнопка «Добавить клиента» выше).'}
              </p>
              {!c.phone && (
                <button
                  onClick={openClientPicker}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50 dark:border-amber-500/40 dark:bg-slate-800 dark:text-amber-300"
                >
                  <IcoPlus className="h-4 w-4" /> Выбрать клиента
                </button>
              )}
            </div>
          )}

          {c.method === 'TRANSFER' && (
            <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
              {c.transferQr || c.transferRequisite ? (
                <>
                  QR для перевода показан на <b>экране покупателя</b> — клиент сканирует и переводит {c.money(c.total)}.
                  {c.transferRequisite && (
                    <div className="mt-1 font-mono text-slate-600 dark:text-slate-300">{c.transferRequisite}</div>
                  )}
                </>
              ) : (
                'Загрузите QR для перевода в «Настройки → Оплата» — он появится на экране покупателя.'
              )}
            </div>
          )}
        </div>

        {/* Оплатить */}
        <button
          onClick={() => {
            if (c.method === 'CASH') {
              c.setCashReceived('');
              setShowCashPay(true);
            } else {
              c.pay();
            }
          }}
          disabled={payDisabled}
          className="mt-4 flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3.5 font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 disabled:shadow-none"
        >
          <span>{c.method === 'DEBT' ? 'Записать в долг' : 'Оплатить'}</span>
          <span className="text-lg font-bold tabular-nums">{c.money(c.total)}</span>
        </button>
        <button
          onClick={c.hold}
          disabled={c.cart.length === 0}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <IcoPause className="h-4 w-4" /> Отложить чек
        </button>
        {c.msg && <p className="mt-2 text-sm text-rose-600">{c.msg}</p>}
      </div>

      {/* ====== Окно выбора клиента ====== */}
      {showClientPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowClientPicker(false)} />
          <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Клиент</h3>
              <button
                onClick={() => setShowClientPicker(false)}
                aria-label="Закрыть"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <input
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
              autoFocus
              placeholder="Поиск по имени или телефону…"
              className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
            <div className="mb-4 max-h-56 flex-1 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              {clientResults.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">
                  {clientQuery.trim().length < 2 ? 'Введите имя или телефон' : 'Ничего не найдено'}
                </div>
              ) : (
                clientResults.map((cl) => (
                  <button
                    key={cl.id}
                    onClick={() => {
                      c.setPhone(cl.phone);
                      c.setClientName(cl.fullName ?? '');
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
                  setShowClientPicker(false);
                }}
                disabled={!newClientPhone.trim()}
                className="mt-2 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                Добавить клиента
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
              <button
                onClick={() => setShowCashPay(false)}
                aria-label="Закрыть"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
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
              <button
                type="button"
                onClick={() => c.setCashReceived(String(c.total))}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              >
                Без сдачи
              </button>
              {cashSuggest.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => c.setCashReceived(String(v))}
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                >
                  {c.money(v)}
                </button>
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
              onClick={() => {
                setShowCashPay(false);
                c.pay();
              }}
              disabled={c.payBusy || (!!c.cashReceived && c.change < 0)}
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

/* ============================ Каталог (левая часть) ============================ */
type TypeFilter = 'ALL' | 'SERVICE' | 'PRODUCT';

// Множество id категории + всех её подкатегорий (двухуровневые категории).
// Нужно, чтобы при выборе родительской категории показывались товары из её
// подкатегорий, а не пустой список.
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

export const SkinPrime: FC<{ ctx: PosCtx }> = ({ ctx }) => {
  const c = ctx;
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [activeCat, setActiveCat] = useState('ALL');
  const [q, setQ] = useState('');

  const items = useMemo(
    () => [
      ...c.services.map((s) => ({ ...s, _type: 'SERVICE' as const })),
      ...c.products.map((p) => ({ ...p, _type: 'PRODUCT' as const })),
    ],
    [c.services, c.products],
  );

  // Категории — под выбранный тип (для «Все» показываем обе группы)
  const cats =
    typeFilter === 'SERVICE' ? c.serviceCats : typeFilter === 'PRODUCT' ? c.productCats : [...c.serviceCats, ...c.productCats];

  const byType = items.filter((i) => typeFilter === 'ALL' || i._type === typeFilter);
  // Счётчик по категории включает подкатегории (чтобы цифра на родителе не была 0).
  const countFor = (catId: string) => {
    const set = catWithDescendants(cats, catId);
    return byType.filter((i) => set.has(i.categoryId)).length;
  };

  const activeCatSet =
    activeCat === 'ALL' ? null : catWithDescendants(cats, activeCat);
  const ql = q.trim().toLowerCase();
  const shown = byType.filter(
    (i) =>
      (!activeCatSet || activeCatSet.has(i.categoryId)) &&
      (!ql ||
        String(i.name ?? '').toLowerCase().includes(ql) ||
        String(i.sku ?? '').toLowerCase().includes(ql) ||
        String(i.barcode ?? '').includes(ql)),
  );

  const switchType = (t: TypeFilter) => {
    setTypeFilter(t);
    setActiveCat('ALL');
  };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {/* Поиск + фильтр типа */}
        <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 transition focus-within:border-indigo-400 focus-within:bg-white dark:border-slate-700">
              <IcoSearch className="h-[18px] w-[18px] shrink-0 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  // Enter = штрихкод: точное совпадение отправит товар в корзину
                  if (e.key === 'Enter' && q.trim()) {
                    c.scan(q.trim());
                    setQ('');
                  }
                }}
                placeholder="Поиск или штрихкод…"
                aria-label="Поиск товара или услуги, или штрихкод"
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
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
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {(
                [
                  { k: 'ALL', l: 'Все' },
                  { k: 'SERVICE', l: 'Услуги' },
                  { k: 'PRODUCT', l: 'Товары' },
                ] as { k: TypeFilter; l: string }[]
              ).map((t) => (
                <button
                  key={t.k}
                  onClick={() => switchType(t.k)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                    typeFilter === t.k
                      ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-300'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                  }`}
                >
                  {t.l}
                </button>
              ))}
            </div>
          </div>

          {/* Категории */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCat('ALL')}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                activeCat === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              Все · {byType.length}
            </button>
            {cats.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCat(cat.id)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  activeCat === cat.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {cat.name}
                <span className={`ml-1.5 text-xs ${activeCat === cat.id ? 'text-white/70' : 'text-slate-400'}`}>
                  {countFor(cat.id)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Плитки */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {shown.map((it) => (
            <button
              key={`${it._type}:${it.id}`}
              onClick={() => c.addItem(it, it._type)}
              className="group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg dark:border-slate-700/60"
            >
              <div className="relative h-24 overflow-hidden">
                <Thumb name={it.name} src={it.imageUrl} className="h-full w-full rounded-none text-3xl" />
                <span
                  className={`absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                    it._type === 'SERVICE'
                      ? 'bg-violet-600/90 text-white'
                      : 'bg-sky-600/90 text-white'
                  }`}
                >
                  {it._type === 'SERVICE' ? 'Услуга' : 'Товар'}
                </span>
              </div>
              <div className="p-3">
                <div className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800 dark:text-slate-200">
                  {it.name}
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                    {c.money(c.priceOf(it, it._type))}
                  </span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition group-hover:bg-indigo-600 group-hover:text-white dark:bg-slate-800">
                    <IcoPlus className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            </button>
          ))}
          {shown.length === 0 && (
            <div className="col-span-full rounded-2xl border-2 border-dashed border-slate-200 py-14 text-center dark:border-slate-700">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Ничего не найдено</p>
              <p className="mt-1 text-xs text-slate-400">Измените запрос или выберите другую категорию</p>
            </div>
          )}
        </div>
      </div>

      <OrderPanelPrime ctx={c} />
    </div>
  );
};
