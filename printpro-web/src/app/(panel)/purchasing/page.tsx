'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  TableCard,
  Toolbar,
  SectionTitle,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';

const RECEIPT_STATUS: Record<string, { label: string; tone: 'emerald' | 'amber' | 'rose' }> = {
  PAID: { label: 'Оплачено', tone: 'emerald' },
  PARTIAL: { label: 'Частично', tone: 'amber' },
  DEBT: { label: 'В долг', tone: 'rose' },
};

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
  const [sInn, setSInn] = useState('');
  const [sMsg, setSMsg] = useState('');

  // Приёмка
  const [supplierId, setSupplierId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [rows, setRows] = useState<Row[]>([{ productId: '', quantity: '', cost: '' }]);
  const [paidAmount, setPaidAmount] = useState('');
  const [rMsg, setRMsg] = useState('');

  // Оплата долга поставщику (модальное окно)
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMsg, setPayMsg] = useState('');

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
        inn: sInn || undefined,
      });
      setSName('');
      setSPhone('');
      setSInn('');
      setSMsg('✓ Поставщик добавлен');
      load();
    } catch (err: any) {
      setSMsg('Ошибка: ' + err.message);
    }
  }

  function openPay(s: any) {
    setPayTarget(s);
    setPayAmount(String(Number(s.debt) || ''));
    setPayMsg('');
  }

  async function submitPay(e: React.FormEvent) {
    e.preventDefault();
    if (!payTarget) return;
    const amount = Number(payAmount);
    const debt = Number(payTarget.debt) || 0;
    if (!amount || amount <= 0) {
      setPayMsg('Введите сумму больше нуля');
      return;
    }
    if (amount > debt + 0.01) {
      setPayMsg(`Сумма больше долга (${money(debt)})`);
      return;
    }
    try {
      await api.post(`/purchasing/suppliers/${payTarget.id}/pay-debt`, { amount });
      setPayTarget(null);
      load();
    } catch (err: any) {
      setPayMsg('Ошибка: ' + err.message);
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
        paidAmount: paidAmount !== '' ? Number(paidAmount) : undefined,
        items,
      });
      setRows([{ productId: '', quantity: '', cost: '' }]);
      setPaidAmount('');
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

  const receiptsValue = receipts.reduce(
    (s, r) => s + (r.total != null ? Number(r.total) : receiptSum(r)),
    0,
  );
  const supplierDebt = suppliers.reduce((s, x) => s + Number(x.debt || 0), 0);

  return (
    <div>
      <PageHeader icon="purchasing" title="Закупки" subtitle="Поставщики, приёмка товара и история закупок" />

      <StatGrid cols={4}>
        <StatCard icon="purchasing" tone="indigo" label="Поставщиков" value={suppliers.length} highlight />
        <StatCard icon="reports" tone="sky" label="Приёмок" value={receipts.length} />
        <StatCard icon="cash" tone="emerald" label="Сумма закупок" value={money(receiptsValue)} sub="по всем приёмкам" />
        <StatCard icon="alert" tone="rose" label="Долг поставщикам" value={money(supplierDebt)} sub={supplierDebt > 0 ? 'нужно оплатить' : 'нет долгов'} />
      </StatGrid>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        {/* Поставщики */}
        <Card>
          <SectionTitle>Поставщики</SectionTitle>
          {canManage && (
            <form onSubmit={addSupplier} className="mb-3 space-y-2">
              <Input
                value={sName}
                onChange={(e) => setSName(e.target.value)}
                placeholder="Название"
                required
              />
              <div className="flex gap-2">
                <Input
                  value={sPhone}
                  onChange={(e) => setSPhone(e.target.value)}
                  placeholder="Телефон"
                  className="flex-1"
                />
                <Input
                  value={sInn}
                  onChange={(e) => setSInn(e.target.value)}
                  placeholder="ИНН"
                  className="w-28"
                />
                <Button type="submit" className="shrink-0">+</Button>
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
                  className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700 py-1.5 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-slate-700 dark:text-slate-200">{s.name}</div>
                    {Number(s.debt) > 0 && (
                      <div className="text-xs font-medium text-rose-600 dark:text-rose-400">
                        долг {money(Number(s.debt))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-slate-400 dark:text-slate-500">{s.phone}</span>
                    {canManage && Number(s.debt) > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => openPay(s)}>
                        Оплатить
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Приёмка */}
        {canManage && (
          <Card className="lg:col-span-2">
            <SectionTitle>Приёмка товара на склад</SectionTitle>
            <form onSubmit={submitReceipt} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Поставщик">
                  <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">— поставщик (необяз.) —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {branches.length > 1 && (
                  <Field label="Филиал">
                    <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>

              {/* Позиции */}
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <Select
                      value={r.productId}
                      onChange={(e) => setRow(i, { productId: e.target.value })}
                      className="flex-1"
                    >
                      <option value="">— товар —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={r.quantity}
                      onChange={(e) => setRow(i, { quantity: e.target.value })}
                      type="number"
                      step="0.001"
                      placeholder="Кол-во"
                      className="w-24"
                    />
                    <Input
                      value={r.cost}
                      onChange={(e) => setRow(i, { cost: e.target.value })}
                      type="number"
                      step="0.01"
                      placeholder="Цена/ед"
                      className="w-24"
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="inline-flex px-2 text-slate-400 dark:text-slate-500 hover:text-rose-600"
                    >
                      <NavIcon name="close" className="h-4 w-4" />
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

              <Field label="Оплачено поставщику сейчас">
                <Input
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  type="number"
                  step="0.01"
                  placeholder={`пусто = оплачено полностью (${receiptTotal.toFixed(2)})`}
                />
              </Field>
              <p className="-mt-1 text-xs text-slate-400">
                Меньше суммы закупки — остаток уйдёт в долг поставщику.
              </p>

              <Button type="submit" variant="emerald" className="w-full">Принять на склад</Button>
              {rMsg && <p className="text-sm text-slate-600 dark:text-slate-300">{rMsg}</p>}
            </form>
          </Card>
        )}
      </div>

      {/* История приёмок */}
      <TableCard>
        <Toolbar>
          <SectionTitle className="mb-0">История приёмок</SectionTitle>
        </Toolbar>
        {receipts.length === 0 ? (
          <EmptyState icon="purchasing" title="Приёмок пока нет" hint="Проведите первую приёмку товара, чтобы пополнить склад." />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Документ</th>
                  <th>Дата</th>
                  <th>Поставщик</th>
                  <th>Филиал</th>
                  <th className="text-right">Позиций</th>
                  <th className="text-right">Сумма</th>
                  <th>Оплата</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">
                      {r.number ?? '—'}
                    </td>
                    <td className="text-slate-500 dark:text-slate-400">
                      {new Date(r.date).toLocaleDateString('ru-RU')}
                    </td>
                    <td className="text-slate-700 dark:text-slate-200">
                      {r.supplier?.name ?? '—'}
                    </td>
                    <td className="text-slate-500 dark:text-slate-400">{r.branch?.name ?? '—'}</td>
                    <td className="text-right text-slate-500 dark:text-slate-400">
                      {r.items.length}
                    </td>
                    <td className="text-right font-medium text-slate-800 dark:text-slate-100">
                      {money(r.total != null ? Number(r.total) : receiptSum(r))}
                    </td>
                    <td>
                      {r.paymentStatus && RECEIPT_STATUS[r.paymentStatus] ? (
                        <Badge tone={RECEIPT_STATUS[r.paymentStatus].tone}>
                          {RECEIPT_STATUS[r.paymentStatus].label}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      {/* ===================== ОПЛАТА ДОЛГА ПОСТАВЩИКУ (модальное окно) ===================== */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setPayTarget(null)}
          />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Оплата поставщику</h3>
              <button
                onClick={() => setPayTarget(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <NavIcon name="close" className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/40">
              <div className="font-medium text-slate-700 dark:text-slate-200">{payTarget.name}</div>
              <div className="mt-0.5 text-rose-600 dark:text-rose-400">
                Текущий долг: <b>{money(Number(payTarget.debt) || 0)}</b>
              </div>
            </div>

            <form onSubmit={submitPay} className="space-y-3">
              <Field label="Сумма оплаты">
                <Input
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  required
                />
              </Field>
              <p className="-mt-1 text-xs text-slate-400">
                Спишется из кассы (расход) и уменьшит долг поставщику.
              </p>

              {payMsg && <p className="text-sm text-rose-600">{payMsg}</p>}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setPayTarget(null)} className="flex-1">Отмена</Button>
                <Button type="submit" variant="emerald" className="flex-1">Оплатить</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
