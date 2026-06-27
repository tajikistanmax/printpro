'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';

interface Line {
  itemType: 'SERVICE' | 'PRODUCT';
  refId: string; // serviceId или productId
  description: string;
  quantity: number;
  unitPrice: number;
}

const ORDER_TYPES = [
  { value: 'SALE', label: 'Продажа товара' },
  { value: 'PRINT', label: 'Печать / дизайн' },
  { value: 'REPAIR', label: 'Ремонт' },
  { value: 'RECOVERY', label: 'Восстановление данных' },
];

export default function NewOrderPage() {
  const cid = DEFAULT_COMPANY_ID;
  const router = useRouter();

  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);

  const [orderType, setOrderType] = useState('SALE');
  const [branchId, setBranchId] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientName, setClientName] = useState('');
  const [note, setNote] = useState('');
  const [decrementStock, setDecrementStock] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);

  // Доп. поля
  const [deviceModel, setDeviceModel] = useState('');
  const [problem, setProblem] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [whatToRecover, setWhatToRecover] = useState('');

  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/services?companyId=${cid}`).then(setServices).catch(() => {});
    api.get(`/products?companyId=${cid}`).then(setProducts).catch(() => {});
    api
      .get(`/branches?companyId=${cid}`)
      .then((b) => {
        setBranches(b);
        if (b[0]) setBranchId(b[0].id);
      })
      .catch(() => {});
  }, [cid]);

  function addLine(itemType: 'SERVICE' | 'PRODUCT') {
    setLines((l) => [
      ...l,
      { itemType, refId: '', description: '', quantity: 1, unitPrice: 0 },
    ]);
  }

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((l) => l.map((ln, idx) => (idx === i ? { ...ln, ...patch } : ln)));
  }

  function removeLine(i: number) {
    setLines((l) => l.filter((_, idx) => idx !== i));
  }

  // При выборе товара/услуги — подставляем имя и цену
  function pickRef(i: number, refId: string) {
    const line = lines[i];
    if (line.itemType === 'SERVICE') {
      const s = services.find((x) => x.id === refId);
      updateLine(i, {
        refId,
        description: s?.name ?? '',
        unitPrice: Number(s?.basePrice ?? 0),
      });
    } else {
      const p = products.find((x) => x.id === refId);
      updateLine(i, {
        refId,
        description: p?.name ?? '',
        unitPrice: Number(p?.salePrice ?? 0),
      });
    }
  }

  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    if (lines.length === 0) {
      setMsg('Добавьте хотя бы одну позицию');
      return;
    }
    setBusy(true);
    try {
      const body: any = {
        companyId: cid,
        branchId: branchId || undefined,
        orderType,
        clientPhone: clientPhone || undefined,
        clientName: clientName || undefined,
        note: note || undefined,
        decrementStock,
        items: lines.map((l) => ({
          itemType: l.itemType,
          serviceId: l.itemType === 'SERVICE' ? l.refId || undefined : undefined,
          productId: l.itemType === 'PRODUCT' ? l.refId || undefined : undefined,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
        })),
      };
      if (orderType === 'REPAIR') body.repairDetail = { deviceModel, problem };
      if (orderType === 'RECOVERY')
        body.recoveryDetail = { deviceType, whatToRecover };

      const order = await api.post('/orders', body);
      router.push(`/orders?created=${order.orderNumber}`);
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Новый заказ</h1>
        <Link href="/orders" className="text-sm text-slate-500 hover:text-slate-700">
          ← к списку
        </Link>
      </div>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        {/* Левая часть — параметры */}
        <div className="space-y-4 lg:col-span-2">
          {/* Тип и филиал */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-slate-500">Тип заказа</label>
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  {ORDER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-500">Филиал</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Клиент */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700">Клиент</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <input
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="Телефон"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Имя (необязательно)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
          </div>

          {/* Детали ремонта/восстановления */}
          {orderType === 'REPAIR' && (
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-semibold text-slate-700">Ремонт</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  value={deviceModel}
                  onChange={(e) => setDeviceModel(e.target.value)}
                  placeholder="Модель устройства"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
                <input
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  placeholder="Неисправность"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
          )}
          {orderType === 'RECOVERY' && (
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-semibold text-slate-700">Восстановление данных</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  value={deviceType}
                  onChange={(e) => setDeviceType(e.target.value)}
                  placeholder="Носитель (HDD/SSD/USB/карта)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
                <input
                  value={whatToRecover}
                  onChange={(e) => setWhatToRecover(e.target.value)}
                  placeholder="Что восстановить"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
          )}

          {/* Позиции */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-700">Позиции</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => addLine('SERVICE')}
                  className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200"
                >
                  + Услуга
                </button>
                <button
                  type="button"
                  onClick={() => addLine('PRODUCT')}
                  className="rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-200"
                >
                  + Товар
                </button>
              </div>
            </div>

            {lines.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">
                Добавьте услугу или товар
              </p>
            ) : (
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        l.itemType === 'SERVICE'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {l.itemType === 'SERVICE' ? 'Услуга' : 'Товар'}
                    </span>
                    <select
                      value={l.refId}
                      onChange={(e) => pickRef(i, e.target.value)}
                      className="min-w-[180px] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">— выбрать —</option>
                      {(l.itemType === 'SERVICE' ? services : products).map(
                        (x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ),
                      )}
                    </select>
                    <input
                      type="number"
                      value={l.quantity}
                      min={0.001}
                      step="0.001"
                      onChange={(e) =>
                        updateLine(i, { quantity: Number(e.target.value) })
                      }
                      className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      title="Количество"
                    />
                    <input
                      type="number"
                      value={l.unitPrice}
                      min={0}
                      step="0.01"
                      onChange={(e) =>
                        updateLine(i, { unitPrice: Number(e.target.value) })
                      }
                      className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      title="Цена"
                    />
                    <span className="w-20 text-right text-sm font-medium text-slate-600">
                      {(l.quantity * l.unitPrice).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="rounded px-2 text-rose-500 hover:bg-rose-50"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Правая часть — итог */}
        <div className="space-y-4">
          <div className="sticky top-8 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700">Итог</h2>
            <div className="mb-4 text-3xl font-bold text-slate-800">
              {total.toFixed(2)} c.
            </div>

            <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={decrementStock}
                onChange={(e) => setDecrementStock(e.target.checked)}
              />
              Списать товары со склада
            </label>

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Примечание к заказу"
              rows={2}
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />

            {msg && (
              <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {msg}
              </div>
            )}

            <button
              disabled={busy}
              className="w-full rounded-lg bg-indigo-600 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? 'Создание…' : 'Создать заказ'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
