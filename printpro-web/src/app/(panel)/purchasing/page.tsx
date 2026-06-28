'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

interface Row {
  productId: string;
  quantity: string;
  cost: string;
}

export default function PurchasingPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('stock.manage');

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);

  // Новый поставщик
  const [sName, setSName] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sMsg, setSMsg] = useState('');

  // Приёмка
  const [supplierId, setSupplierId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [rows, setRows] = useState<Row[]>([{ productId: '', quantity: '', cost: '' }]);
  const [rMsg, setRMsg] = useState('');

  function load() {
    Promise.all([
      api.get(`/purchasing/suppliers?companyId=${cid}`),
      api.get(`/products?companyId=${cid}`),
      api.get(`/branches?companyId=${cid}`),
      api.get(`/purchasing/receipts?companyId=${cid}`),
    ])
      .then(([s, p, b, r]) => {
        setSuppliers(s);
        setProducts(p);
        setBranches(b);
        setReceipts(r);
        if (b[0]) setBranchId(b[0].id);
      })
      .catch(() => {});
  }
  useEffect(load, [cid]);

  async function addSupplier(e: React.FormEvent) {
    e.preventDefault();
    setSMsg('');
    try {
      await api.post('/purchasing/suppliers', {
        companyId: cid,
        name: sName,
        phone: sPhone || undefined,
      });
      setSName('');
      setSPhone('');
      setSMsg('✓ Поставщик добавлен');
      load();
    } catch (err: any) {
      setSMsg('Ошибка: ' + err.message);
    }
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { productId: '', quantity: '', cost: '' }]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));
  }

  const receiptTotal = rows.reduce(
    (s, r) => s + (Number(r.quantity) || 0) * (Number(r.cost) || 0),
    0,
  );

  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault();
    setRMsg('');
    const items = rows
      .filter((r) => r.productId && Number(r.quantity) > 0)
      .map((r) => ({
        productId: r.productId,
        quantity: Number(r.quantity),
        cost: r.cost ? Number(r.cost) : 0,
      }));
    if (items.length === 0) {
      setRMsg('Добавьте хотя бы одну позицию');
      return;
    }
    try {
      await api.post('/purchasing/receipts', {
        companyId: cid,
        branchId,
        supplierId: supplierId || undefined,
        items,
      });
      setRows([{ productId: '', quantity: '', cost: '' }]);
      setRMsg('✓ Приёмка проведена, склад пополнен');
      load();
    } catch (err: any) {
      setRMsg('Ошибка: ' + err.message);
    }
  }

  function receiptSum(r: any) {
    return r.items.reduce(
      (s: number, it: any) => s + Number(it.quantity) * Number(it.cost),
      0,
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800 dark:text-slate-100">Закупки</h1>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        {/* Поставщики */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Поставщики</h2>
          {canManage && (
            <form onSubmit={addSupplier} className="mb-3 space-y-2">
              <input
                value={sName}
                onChange={(e) => setSName(e.target.value)}
                placeholder="Название"
                required
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100"
              />
              <div className="flex gap-2">
                <input
                  value={sPhone}
                  onChange={(e) => setSPhone(e.target.value)}
                  placeholder="Телефон"
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100"
                />
                <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                  +
                </button>
              </div>
              {sMsg && <p className="text-xs text-slate-500 dark:text-slate-400">{sMsg}</p>}
            </form>
          )}
          <div className="space-y-1">
            {suppliers.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">Пока нет поставщиков.</p>
            ) : (
              suppliers.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 py-1.5 text-sm last:border-0"
                >
                  <span className="text-slate-700 dark:text-slate-200">{s.name}</span>
                  <span className="text-slate-400 dark:text-slate-500">{s.phone}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Приёмка */}
        {canManage && (
          <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm lg:col-span-2">
            <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">
              Приёмка товара на склад
            </h2>
            <form onSubmit={submitReceipt} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">— поставщик (необяз.) —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Позиции */}
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <select
                      value={r.productId}
                      onChange={(e) => setRow(i, { productId: e.target.value })}
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="">— товар —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={r.quantity}
                      onChange={(e) => setRow(i, { quantity: e.target.value })}
                      type="number"
                      step="0.001"
                      placeholder="Кол-во"
                      className="w-24 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-800 dark:text-slate-100"
                    />
                    <input
                      value={r.cost}
                      onChange={(e) => setRow(i, { cost: e.target.value })}
                      type="number"
                      step="0.01"
                      placeholder="Цена/ед"
                      className="w-24 rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="px-2 text-slate-400 dark:text-slate-500 hover:text-rose-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={addRow}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                >
                  + позиция
                </button>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  Сумма закупки:{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    {money(receiptTotal)}
                  </span>
                </span>
              </div>

              <button className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white hover:bg-emerald-700">
                Принять на склад
              </button>
              {rMsg && <p className="text-sm text-slate-600 dark:text-slate-300">{rMsg}</p>}
            </form>
          </div>
        )}
      </div>

      {/* История приёмок */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">История приёмок</h2>
        {receipts.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Приёмок пока нет.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-400 dark:text-slate-500">
                <th className="py-2 font-medium">Документ</th>
                <th className="py-2 font-medium">Дата</th>
                <th className="py-2 font-medium">Поставщик</th>
                <th className="py-2 font-medium">Филиал</th>
                <th className="py-2 text-right font-medium">Позиций</th>
                <th className="py-2 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800 last:border-0">
                  <td className="py-2 font-medium text-slate-700 dark:text-slate-200">
                    {r.number ?? '—'}
                  </td>
                  <td className="py-2 text-slate-500 dark:text-slate-400">
                    {new Date(r.date).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="py-2 text-slate-700 dark:text-slate-200">
                    {r.supplier?.name ?? '—'}
                  </td>
                  <td className="py-2 text-slate-500 dark:text-slate-400">{r.branch?.name ?? '—'}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">
                    {r.items.length}
                  </td>
                  <td className="py-2 text-right font-medium text-slate-800 dark:text-slate-100">
                    {money(receiptSum(r))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
