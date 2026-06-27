'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

interface CartItem {
  key: string;
  itemType: 'SERVICE' | 'PRODUCT';
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

const METHODS = [
  { k: 'CASH', l: 'Наличные' },
  { k: 'CARD', l: 'Карта' },
  { k: 'TRANSFER', l: 'Перевод' },
];

export default function PosPage() {
  const cid = DEFAULT_COMPANY_ID;
  const [tab, setTab] = useState<'SERVICE' | 'PRODUCT'>('SERVICE');
  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');

  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState('');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState('CASH');
  const [msg, setMsg] = useState('');
  const [receipt, setReceipt] = useState<any | null>(null);

  useEffect(() => {
    api.get(`/services?companyId=${cid}`).then(setServices).catch(() => {});
    api.get(`/products?companyId=${cid}`).then(setProducts).catch(() => {});
    api
      .get(`/branches?companyId=${cid}`)
      .then((b) => b[0] && setBranchId(b[0].id))
      .catch(() => {});
  }, [cid]);

  const catalog = tab === 'SERVICE' ? services : products;
  const filtered = useMemo(
    () =>
      catalog.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [catalog, search, tab],
  );

  function addItem(c: any) {
    const itemType = tab;
    const id = c.id;
    const unitPrice = Number(tab === 'SERVICE' ? c.basePrice : c.salePrice) || 0;
    const key = `${itemType}:${id}`;
    setCart((prev) => {
      const ex = prev.find((p) => p.key === key);
      if (ex)
        return prev.map((p) =>
          p.key === key ? { ...p, quantity: p.quantity + 1 } : p,
        );
      return [...prev, { key, itemType, id, name: c.name, unitPrice, quantity: 1 }];
    });
  }

  function setQty(key: string, q: number) {
    setCart((prev) =>
      prev
        .map((p) => (p.key === key ? { ...p, quantity: Math.max(0, q) } : p))
        .filter((p) => p.quantity > 0),
    );
  }

  const subtotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
  const disc = Math.min(Number(discount) || 0, subtotal);
  const total = Math.max(0, subtotal - disc);

  async function pay() {
    if (cart.length === 0) return;
    setMsg('');
    try {
      const order = await api.post('/orders/quick-sale', {
        companyId: cid,
        branchId: branchId || undefined,
        clientPhone: phone || undefined,
        discount: disc || undefined,
        method,
        items: cart.map((c) => ({
          itemType: c.itemType,
          serviceId: c.itemType === 'SERVICE' ? c.id : undefined,
          productId: c.itemType === 'PRODUCT' ? c.id : undefined,
          description: c.name,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
        })),
      });
      setReceipt({
        ...order,
        _method: METHODS.find((m) => m.k === method)?.l,
        _date: new Date().toLocaleString('ru-RU'),
      });
      setCart([]);
      setDiscount('');
      setPhone('');
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Касса — продажа</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Каталог */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {(['SERVICE', 'PRODUCT'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                    tab === t ? 'bg-indigo-600 text-white' : 'text-slate-500'
                  }`}
                >
                  {t === 'SERVICE' ? 'Услуги' : 'Товары'}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск…"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => addItem(c)}
                className="rounded-xl border border-slate-200 p-3 text-left transition hover:border-indigo-400 hover:bg-indigo-50"
              >
                <div className="text-sm font-medium text-slate-800">{c.name}</div>
                <div className="mt-1 text-sm text-indigo-600">
                  {money(Number(tab === 'SERVICE' ? c.basePrice : c.salePrice) || 0)}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm text-slate-400">
                Ничего не найдено
              </p>
            )}
          </div>
        </div>

        {/* Корзина */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700">Чек</h2>
          {cart.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              Добавьте услуги или товары
            </p>
          ) : (
            <div className="mb-3 space-y-2">
              {cart.map((c) => (
                <div key={c.key} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-slate-700">{c.name}</span>
                  <button
                    onClick={() => setQty(c.key, c.quantity - 1)}
                    className="h-6 w-6 rounded bg-slate-100 text-slate-600"
                  >
                    −
                  </button>
                  <span className="w-6 text-center">{c.quantity}</span>
                  <button
                    onClick={() => setQty(c.key, c.quantity + 1)}
                    className="h-6 w-6 rounded bg-slate-100 text-slate-600"
                  >
                    +
                  </button>
                  <span className="w-20 text-right font-medium text-slate-800">
                    {money(c.unitPrice * c.quantity)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Телефон клиента (необяз.)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Подытог</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Скидка</span>
              <input
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                type="number"
                min="0"
                placeholder="0"
                className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right"
              />
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-lg font-bold">
              <span>Итого</span>
              <span className="text-indigo-600">{money(total)}</span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {METHODS.map((m) => (
                <button
                  key={m.k}
                  onClick={() => setMethod(m.k)}
                  className={`rounded-lg py-2 text-xs font-medium transition ${
                    method === m.k
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {m.l}
                </button>
              ))}
            </div>

            <button
              onClick={pay}
              disabled={cart.length === 0}
              className="w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              Оплатить и выдать
            </button>
            {msg && <p className="text-sm text-rose-600">{msg}</p>}
          </div>
        </div>
      </div>

      {/* Чек после продажи */}
      {receipt && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-80 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="receipt-print">
              <div className="text-center">
                <div className="text-lg font-bold">PrintPro</div>
                <div className="text-xs text-slate-500">Чек продажи</div>
              </div>
              <div className="my-3 border-y border-dashed border-slate-300 py-2 text-xs">
                <div className="flex justify-between">
                  <span>Заказ</span>
                  <span>№{receipt.orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>Дата</span>
                  <span>{receipt._date}</span>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                {receipt.items?.map((it: any) => (
                  <div key={it.id} className="flex justify-between">
                    <span>
                      {it.description ||
                        it.service?.name ||
                        it.product?.name}{' '}
                      ×{Number(it.quantity)}
                    </span>
                    <span>{money(Number(it.lineTotal))}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-dashed border-slate-300 pt-2">
                <div className="flex justify-between font-bold">
                  <span>Итого</span>
                  <span>{money(Number(receipt.total))}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Оплата</span>
                  <span>{receipt._method}</span>
                </div>
              </div>
              <div className="mt-3 text-center text-xs text-slate-400">
                Спасибо за заказ!
              </div>
            </div>

            <div className="no-print mt-5 flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                🖨 Печать
              </button>
              <button
                onClick={() => setReceipt(null)}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Новая продажа
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
