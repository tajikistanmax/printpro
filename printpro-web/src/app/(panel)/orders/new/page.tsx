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
  const [users, setUsers] = useState<any[]>([]);

  const [orderType, setOrderType] = useState('SALE');
  const [branchId, setBranchId] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientName, setClientName] = useState('');
  const [note, setNote] = useState('');
  const [decrementStock, setDecrementStock] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);

  // Характеристики заказа (п. 2.4 ТЗ)
  const [format, setFormat] = useState('');
  const [colorMode, setColorMode] = useState('');
  const [urgency, setUrgency] = useState('NORMAL');
  const [designerId, setDesignerId] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [deadline, setDeadline] = useState('');

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
    api.get(`/users?companyId=${cid}`).then(setUsers).catch(() => {});
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
        format: format || undefined,
        colorMode: colorMode || undefined,
        urgency,
        designerId: designerId || undefined,
        operatorId: operatorId || undefined,
        deadline: deadline ? new Date(deadline).toISOString() : undefined,
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
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Новый заказ</h1>
        <Link href="/orders" className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          ← к списку
        </Link>
      </div>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        {/* Левая часть — параметры */}
        <div className="space-y-4 lg:col-span-2">
          {/* Тип и филиал */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Тип заказа</label>
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                >
                  {ORDER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Филиал</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
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
          <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Клиент</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <input
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="Телефон"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
              />
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Имя (необязательно)"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Характеристики заказа */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Характеристики</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {orderType === 'PRINT' && (
                <>
                  <div>
                    <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Формат</label>
                    <input
                      value={format}
                      onChange={(e) => setFormat(e.target.value)}
                      placeholder="A4, A3, баннер 1×2м…"
                      list="format-list"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <datalist id="format-list">
                      <option value="A4" />
                      <option value="A3" />
                      <option value="A2" />
                      <option value="A1" />
                      <option value="A0" />
                      <option value="10×15" />
                      <option value="Баннер" />
                    </datalist>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Цветность</label>
                    <select
                      value={colorMode}
                      onChange={(e) => setColorMode(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="">— не указано —</option>
                      <option value="Цветной">Цветной</option>
                      <option value="Ч/Б">Чёрно-белый</option>
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Срочность</label>
                <select
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="NORMAL">Обычная</option>
                  <option value="URGENT">Срочно</option>
                  <option value="EXPRESS">Экспресс</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Срок готовности</label>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Дизайнер</label>
                <select
                  value={designerId}
                  onChange={(e) => setDesignerId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">— не назначен —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">
                  Оператор / печатник
                </label>
                <select
                  value={operatorId}
                  onChange={(e) => setOperatorId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">— не назначен —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Детали ремонта/восстановления */}
          {orderType === 'REPAIR' && (
            <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
              <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Ремонт</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  value={deviceModel}
                  onChange={(e) => setDeviceModel(e.target.value)}
                  placeholder="Модель устройства"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                />
                <input
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  placeholder="Неисправность"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
          )}
          {orderType === 'RECOVERY' && (
            <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
              <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Восстановление данных</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  value={deviceType}
                  onChange={(e) => setDeviceType(e.target.value)}
                  placeholder="Носитель (HDD/SSD/USB/карта)"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                />
                <input
                  value={whatToRecover}
                  onChange={(e) => setWhatToRecover(e.target.value)}
                  placeholder="Что восстановить"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
          )}

          {/* Позиции */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-700 dark:text-slate-200">Позиции</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => addLine('SERVICE')}
                  className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                >
                  + Услуга
                </button>
                <button
                  type="button"
                  onClick={() => addLine('PRODUCT')}
                  className="rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                >
                  + Товар
                </button>
              </div>
            </div>

            {lines.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">
                Добавьте услугу или товар
              </p>
            ) : (
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        l.itemType === 'SERVICE'
                          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      }`}
                    >
                      {l.itemType === 'SERVICE' ? 'Услуга' : 'Товар'}
                    </span>
                    <select
                      value={l.refId}
                      onChange={(e) => pickRef(i, e.target.value)}
                      className="min-w-[180px] flex-1 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100"
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
                      className="w-20 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100"
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
                      className="w-24 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100"
                      title="Цена"
                    />
                    <span className="w-20 text-right text-sm font-medium text-slate-600 dark:text-slate-300">
                      {(l.quantity * l.unitPrice).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="rounded px-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
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
          <div className="sticky top-8 rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Итог</h2>
            <div className="mb-4 text-3xl font-bold text-slate-800 dark:text-slate-100">
              {total.toFixed(2)} c.
            </div>

            <label className="mb-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
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
              className="mb-3 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100"
            />

            {msg && (
              <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
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
