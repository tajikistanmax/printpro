'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  Tabs,
  TableCard,
  Toolbar,
  SearchInput,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
} from '@/components/ui';
import type { TabItem } from '@/components/ui';
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
  name: string;
  unit: string;
  quantity: string;
  cost: string; // закупка
  salePrice: string; // продажа
}

function dateInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function PurchasingPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('stock.manage');

  const [tab, setTab] = useState('receipts');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);

  const [qReceipts, setQReceipts] = useState('');
  const [qSuppliers, setQSuppliers] = useState('');

  // Новый поставщик (модальное окно)
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [sName, setSName] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sInn, setSInn] = useState('');
  const [sMsg, setSMsg] = useState('');

  // Приёмка (модальное окно)
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [prodQuery, setProdQuery] = useState(''); // поиск товара для добавления
  const [payMode, setPayMode] = useState<'full' | 'partial' | 'debt'>('full');
  const [paidAmount, setPaidAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
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

  // ---- поставщик ----
  function openSupplierModal() {
    setSName('');
    setSPhone('');
    setSInn('');
    setSMsg('');
    setSupplierModalOpen(true);
  }
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
      setSupplierModalOpen(false);
      load();
    } catch (err: any) {
      setSMsg('Ошибка: ' + err.message);
    }
  }

  // ---- оплата долга ----
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

  // ---- приёмка ----
  function openReceiptModal() {
    setSupplierId('');
    if (branches[0]) setBranchId(branches[0].id);
    setRows([]);
    setProdQuery('');
    setPayMode('full');
    setPaidAmount('');
    setDueDate('');
    setRMsg('');
    setReceiptModalOpen(true);
  }
  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addProduct(p: any) {
    setProdQuery('');
    setRows((rs) => {
      if (rs.some((r) => r.productId === p.id)) return rs; // уже добавлен
      return [
        ...rs,
        {
          productId: p.id,
          name: p.name,
          unit: p.unit?.shortName ?? '',
          quantity: '1',
          cost: String(Number(p.purchasePrice) || ''),
          salePrice: String(Number(p.salePrice) || ''),
        },
      ];
    });
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  const receiptTotal = rows.reduce(
    (s, r) => s + (Number(r.quantity) || 0) * (Number(r.cost) || 0),
    0,
  );

  // товары для поиска (исключаем уже добавленные)
  const pq = prodQuery.trim().toLowerCase();
  const prodMatches = pq
    ? products
        .filter((p) => !rows.some((r) => r.productId === p.id))
        .filter(
          (p) =>
            String(p.name ?? '').toLowerCase().includes(pq) ||
            String(p.sku ?? '').toLowerCase().includes(pq) ||
            String(p.barcode ?? '').includes(pq),
        )
        .slice(0, 8)
    : [];

  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault();
    setRMsg('');
    const items = rows
      .filter((r) => r.productId && Number(r.quantity) > 0)
      .map((r) => ({
        productId: r.productId,
        quantity: Number(r.quantity),
        cost: r.cost ? Number(r.cost) : 0,
        salePrice: r.salePrice !== '' ? Number(r.salePrice) : undefined,
      }));
    if (items.length === 0) {
      setRMsg('Добавьте хотя бы одну позицию');
      return;
    }
    // Оплата по выбранному режиму
    let paid: number | undefined;
    if (payMode === 'full') paid = undefined; // = оплачено полностью
    else if (payMode === 'debt') paid = 0;
    else {
      paid = paidAmount !== '' ? Number(paidAmount) : 0;
      if (!(paid > 0)) {
        setRMsg('Укажите оплаченную сумму для частичной оплаты');
        return;
      }
      if (paid >= receiptTotal) {
        setRMsg('Оплаченная сумма не меньше суммы закупки — выберите «Полностью»');
        return;
      }
    }
    // Долг требует поставщика и срока оплаты
    if (payMode !== 'full') {
      if (!supplierId) {
        setRMsg('Для долга выберите поставщика');
        return;
      }
      if (!dueDate) {
        setRMsg('Укажите срок, когда нужно оплатить долг');
        return;
      }
    }
    try {
      await api.post('/purchasing/receipts', {
        companyId: cid,
        branchId,
        supplierId: supplierId || undefined,
        paidAmount: paid,
        dueDate: payMode !== 'full' && dueDate ? new Date(dueDate).toISOString() : undefined,
        items,
      });
      setReceiptModalOpen(false);
      setTab('receipts');
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

  // ---- фильтрация ----
  const qr = qReceipts.trim().toLowerCase();
  const filteredReceipts = qr
    ? receipts.filter(
        (r) =>
          String(r.number ?? '').toLowerCase().includes(qr) ||
          String(r.supplier?.name ?? '').toLowerCase().includes(qr),
      )
    : receipts;
  const qs = qSuppliers.trim().toLowerCase();
  const filteredSuppliers = qs
    ? suppliers.filter(
        (s) =>
          String(s.name ?? '').toLowerCase().includes(qs) ||
          String(s.phone ?? '').toLowerCase().includes(qs) ||
          String(s.inn ?? '').toLowerCase().includes(qs),
      )
    : suppliers;

  const tabs: TabItem[] = [
    { key: 'receipts', label: 'Приёмки', count: receipts.length },
    { key: 'suppliers', label: 'Поставщики', count: suppliers.length },
  ];

  return (
    <div>
      <PageHeader
        icon="purchasing"
        title="Закупки"
        subtitle="Поставщики, приёмка товара и история закупок"
        actions={
          canManage && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={openSupplierModal}>
                <NavIcon name="plus" className="h-4 w-4" />Поставщик
              </Button>
              <Button variant="emerald" onClick={openReceiptModal}>
                <NavIcon name="plus" className="h-4 w-4" />Принять товар
              </Button>
            </div>
          )
        }
      />

      <StatGrid cols={4}>
        <StatCard icon="purchasing" tone="indigo" label="Поставщиков" value={suppliers.length} highlight />
        <StatCard icon="reports" tone="sky" label="Приёмок" value={receipts.length} />
        <StatCard icon="cash" tone="emerald" label="Сумма закупок" value={money(receiptsValue)} sub="по всем приёмкам" />
        <StatCard icon="alert" tone="rose" label="Долг поставщикам" value={money(supplierDebt)} sub={supplierDebt > 0 ? 'нужно оплатить' : 'нет долгов'} />
      </StatGrid>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {/* ============ ПРИЁМКИ (история) ============ */}
      {tab === 'receipts' && (
        <TableCard>
          <Toolbar>
            <SearchInput value={qReceipts} onChange={setQReceipts} placeholder="Поиск по документу или поставщику…" />
            <span className="text-sm text-slate-400">Найдено: {filteredReceipts.length}</span>
          </Toolbar>
          {filteredReceipts.length === 0 ? (
            <EmptyState
              icon="purchasing"
              title={receipts.length === 0 ? 'Приёмок пока нет' : 'Ничего не найдено'}
              hint={
                receipts.length === 0
                  ? 'Нажмите «Принять товар», чтобы провести первую приёмку и пополнить склад.'
                  : 'Измените запрос поиска.'
              }
            />
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
                    <th>Срок оплаты</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReceipts.map((r) => (
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
                      <td>
                        {r.dueDate && r.paymentStatus !== 'PAID' ? (
                          (() => {
                            const overdue = new Date(r.dueDate) < new Date();
                            return (
                              <span className={overdue ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}>
                                {new Date(r.dueDate).toLocaleDateString('ru-RU')}
                                {overdue ? ' · просрочено' : ''}
                              </span>
                            );
                          })()
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
      )}

      {/* ============ ПОСТАВЩИКИ ============ */}
      {tab === 'suppliers' && (
        <TableCard>
          <Toolbar>
            <SearchInput value={qSuppliers} onChange={setQSuppliers} placeholder="Поиск по названию, телефону, ИНН…" />
            <span className="text-sm text-slate-400">Найдено: {filteredSuppliers.length}</span>
            {canManage && (
              <Button size="sm" onClick={openSupplierModal} className="ml-auto">
                <NavIcon name="plus" className="h-4 w-4" />Поставщик
              </Button>
            )}
          </Toolbar>
          {filteredSuppliers.length === 0 ? (
            <EmptyState
              icon="purchasing"
              title={suppliers.length === 0 ? 'Поставщиков пока нет' : 'Ничего не найдено'}
              hint={
                suppliers.length === 0
                  ? 'Добавьте поставщика кнопкой «Поставщик».'
                  : 'Измените запрос поиска.'
              }
            />
          ) : (
            <div className="pp-table-scroll">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Поставщик</th>
                    <th>Телефон</th>
                    <th>ИНН</th>
                    <th className="text-right">Долг</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((s) => {
                    const debt = Number(s.debt) || 0;
                    return (
                      <tr key={s.id}>
                        <td className="font-medium text-slate-700 dark:text-slate-200">{s.name}</td>
                        <td className="text-slate-500 dark:text-slate-400">{s.phone || '—'}</td>
                        <td className="text-slate-500 dark:text-slate-400">{s.inn || '—'}</td>
                        <td className="text-right">
                          {debt > 0 ? (
                            <span className="font-semibold text-rose-600 dark:text-rose-400">{money(debt)}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="text-right">
                          {canManage && debt > 0 && (
                            <Button size="sm" variant="ghost" onClick={() => openPay(s)}>
                              <NavIcon name="cash" className="h-4 w-4" />Оплатить
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TableCard>
      )}

      {/* ===================== НОВЫЙ ПОСТАВЩИК (модальное окно) ===================== */}
      {supplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setSupplierModalOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Новый поставщик</h3>
              <button aria-label="Закрыть" onClick={() => setSupplierModalOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><NavIcon name="close" className="h-4 w-4" /></button>
            </div>

            <form onSubmit={addSupplier} className="space-y-3">
              <Field label="Название *">
                <Input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Например: ООО «Бумага»" required autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Телефон">
                  <Input value={sPhone} onChange={(e) => setSPhone(e.target.value)} placeholder="+992…" />
                </Field>
                <Field label="ИНН">
                  <Input value={sInn} onChange={(e) => setSInn(e.target.value)} placeholder="необяз." />
                </Field>
              </div>

              {sMsg && <p className="text-sm text-rose-600">{sMsg}</p>}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setSupplierModalOpen(false)} className="flex-1">Отмена</Button>
                <Button type="submit" variant="emerald" className="flex-1">Добавить поставщика</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================== ПРИЁМКА ТОВАРА (модальное окно) ===================== */}
      {receiptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setReceiptModalOpen(false)} />
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Приёмка товара на склад</h3>
              <button aria-label="Закрыть" onClick={() => setReceiptModalOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><NavIcon name="close" className="h-4 w-4" /></button>
            </div>

            <form onSubmit={submitReceipt} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
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

              {/* Поиск и добавление товара */}
              <div className="relative">
                <SearchInput
                  value={prodQuery}
                  onChange={setProdQuery}
                  placeholder="Поиск товара по названию, артикулу, штрихкоду…"
                  className="max-w-none"
                />
                {prodMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    {prodMatches.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addProduct(p)}
                        className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-700/60"
                      >
                        <span className="truncate font-medium text-slate-700 dark:text-slate-200">{p.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">
                          закуп. {money(Number(p.purchasePrice) || 0)} · прод. {money(Number(p.salePrice) || 0)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {pq && prodMatches.length === 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    Ничего не найдено
                  </div>
                )}
              </div>

              {/* Позиции */}
              <div className="space-y-2">
                {rows.length > 0 && (
                  <div className="flex gap-2 px-1 text-xs font-medium text-slate-400">
                    <span className="flex-1">Товар</span>
                    <span className="w-20 text-center">Кол-во</span>
                    <span className="w-24 text-center">Закупка</span>
                    <span className="w-24 text-center">Продажа</span>
                    <span className="w-6" />
                  </div>
                )}
                {rows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400 dark:border-slate-700">
                    Найдите товар выше и добавьте в приёмку
                  </div>
                ) : (
                  rows.map((r, i) => (
                    <div key={r.productId} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{r.name}</div>
                        {r.unit && <div className="text-xs text-slate-400">ед: {r.unit}</div>}
                      </div>
                      <Input
                        value={r.quantity}
                        onChange={(e) => setRow(i, { quantity: e.target.value })}
                        type="number"
                        step="0.001"
                        placeholder="0"
                        className="w-20 text-right"
                      />
                      <Input
                        value={r.cost}
                        onChange={(e) => setRow(i, { cost: e.target.value })}
                        type="number"
                        step="0.01"
                        placeholder="0"
                        className="w-24 text-right"
                        title="Цена закупки за единицу"
                      />
                      <Input
                        value={r.salePrice}
                        onChange={(e) => setRow(i, { salePrice: e.target.value })}
                        type="number"
                        step="0.01"
                        placeholder="0"
                        className="w-24 text-right"
                        title="Новая цена продажи (обновит цену товара)"
                      />
                      <button
                        type="button"
                        aria-label="Удалить"
                        onClick={() => removeRow(i)}
                        className="inline-flex w-6 shrink-0 items-center justify-center text-slate-400 dark:text-slate-500 hover:text-rose-600"
                      >
                        <NavIcon name="close" className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-end">
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  Сумма закупки:{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    {money(receiptTotal)}
                  </span>
                </span>
              </div>

              {/* Оплата поставщику */}
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40">
                <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Оплата поставщику</div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'full', label: 'Полностью' },
                    { key: 'partial', label: 'Частично' },
                    { key: 'debt', label: 'В долг' },
                  ] as const).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setPayMode(m.key)}
                      className={`rounded-lg border py-2 text-sm font-medium transition ${
                        payMode === m.key
                          ? 'border-indigo-500 bg-indigo-600 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {payMode === 'partial' && (
                  <div className="mt-3">
                    <Field label="Оплачено сейчас">
                      <Input
                        value={paidAmount}
                        onChange={(e) => setPaidAmount(e.target.value)}
                        type="number"
                        step="0.01"
                        placeholder={`меньше ${receiptTotal.toFixed(2)}`}
                      />
                    </Field>
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Остаток{' '}
                      <b>{money(Math.max(0, receiptTotal - (Number(paidAmount) || 0)))}</b>{' '}
                      уйдёт в долг поставщику.
                    </p>
                  </div>
                )}
                {payMode === 'debt' && (
                  <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                    Вся сумма <b>{money(receiptTotal)}</b> запишется в долг поставщику.
                  </p>
                )}

                {payMode !== 'full' && (
                  <div className="mt-3">
                    <Field label="Срок оплаты долга *">
                      <Input
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        type="date"
                        min={dateInput(new Date())}
                      />
                    </Field>
                    <p className="mt-1 text-xs text-slate-400">До этой даты нужно рассчитаться с поставщиком.</p>
                  </div>
                )}
              </div>

              {rMsg && <p className="text-sm text-rose-600">{rMsg}</p>}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setReceiptModalOpen(false)} className="flex-1">Отмена</Button>
                <Button type="submit" variant="emerald" className="flex-1">Принять на склад</Button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                aria-label="Закрыть"
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
