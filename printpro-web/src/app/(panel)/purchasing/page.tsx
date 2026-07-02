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
  Card,
  SectionTitle,
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

// Суммарный остаток товара по всем складам
function stockTotal(p: any) {
  return (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.quantity), 0);
}
// Сколько предложить к заказу: чтобы дотянуть до минимума (но не меньше 1)
function suggestQty(stock: number, minStock: number) {
  return Math.max((minStock || 0) - stock, 1);
}
function escapeHtml(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Строка заявки на закупку
interface ReqRow {
  productId: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  quantity: string;
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
  const [requests, setRequests] = useState<any[]>([]); // сохранённые заявки на закупку

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

  // Заявка на закупку (что нужно докупить) + печать накладной-заявки
  const [reqRows, setReqRows] = useState<ReqRow[]>([]);
  const [reqQuery, setReqQuery] = useState('');
  const [reqFilter, setReqFilter] = useState<'all' | 'low' | 'out'>('all');
  const [reqSupplierId, setReqSupplierId] = useState('');
  const [reqNote, setReqNote] = useState('');

  function load() {
    Promise.all([
      api.get(`/purchasing/suppliers?companyId=${cid}`),
      api.get(`/products?companyId=${cid}`),
      api.get(`/branches?companyId=${cid}`),
      api.get(`/purchasing/receipts?companyId=${cid}`),
      api.get(`/purchasing/requests?companyId=${cid}`),
    ])
      .then(([s, p, b, r, rq]) => {
        setSuppliers(s);
        setProducts(p);
        setBranches(b);
        setReceipts(r);
        setRequests(rq);
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

  // ---- Заявка на закупку ----
  // Дефицит: товар отсутствует (остаток ≤ 0) или заканчивается (остаток ≤ минимума).
  const deficit = products
    .map((p) => ({ p, st: stockTotal(p), min: Number(p.minStock) || 0 }))
    .filter((x) => x.st <= 0 || (x.min > 0 && x.st <= x.min));
  const deficitFiltered = deficit.filter((x) =>
    reqFilter === 'all' ? true : reqFilter === 'out' ? x.st <= 0 : x.st > 0 && x.st <= x.min,
  );
  const reqInList = (id: string) => reqRows.some((r) => r.productId === id);
  const rq = reqQuery.trim().toLowerCase();
  const reqMatches = rq
    ? products
        .filter((p) => !reqInList(p.id))
        .filter(
          (p) =>
            String(p.name ?? '').toLowerCase().includes(rq) ||
            String(p.sku ?? '').toLowerCase().includes(rq) ||
            String(p.barcode ?? '').includes(rq),
        )
        .slice(0, 8)
    : [];
  const reqTotalQty = reqRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  function addReq(p: any) {
    setReqQuery('');
    if (reqInList(p.id)) return;
    const st = stockTotal(p);
    const min = Number(p.minStock) || 0;
    setReqRows((rs) => [
      ...rs,
      { productId: p.id, name: p.name, unit: p.unit?.shortName ?? '', stock: st, minStock: min, quantity: String(suggestQty(st, min)) },
    ]);
  }
  function addAllDeficit() {
    setReqRows((rs) => {
      const have = new Set(rs.map((r) => r.productId));
      const add = deficitFiltered
        .filter((x) => !have.has(x.p.id))
        .map((x) => ({
          productId: x.p.id,
          name: x.p.name,
          unit: x.p.unit?.shortName ?? '',
          stock: x.st,
          minStock: x.min,
          quantity: String(suggestQty(x.st, x.min)),
        }));
      return [...rs, ...add];
    });
  }
  function setReqRow(i: number, patch: Partial<ReqRow>) {
    setReqRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeReqRow(i: number) {
    setReqRows((rs) => rs.filter((_, idx) => idx !== i));
  }
  // Печать накладной-заявки (общий рендер для новой и сохранённой заявки)
  function openRequestPrint(
    number: string | null | undefined,
    dateStr: string,
    supplierName: string | null | undefined,
    note: string | null | undefined,
    items: any[],
  ) {
    const rowsHtml = items
      .map(
        (r, i) =>
          `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td class="c">${escapeHtml(r.unit)}</td><td class="r">${r.stock ?? ''}</td><td class="r">${r.minStock || ''}</td><td class="r b">${Number(r.quantity) || 0}</td></tr>`,
      )
      .join('');
    const totalQty = items.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    const w = window.open('', '_blank', 'width=820,height=920');
    if (!w) return;
    w.document.write(
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Заявка на закупку</title>` +
        `<style>*{font-family:Arial,Helvetica,sans-serif}body{margin:32px;color:#111}` +
        `h1{font-size:20px;margin:0 0 4px}.meta{font-size:13px;color:#333;margin-bottom:16px}` +
        `table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #999;padding:6px 8px}` +
        `th{background:#f0f0f0;text-align:left}td.c{text-align:center}td.r{text-align:right}td.b{font-weight:700}` +
        `tfoot td{font-weight:700}.sign{margin-top:44px;display:flex;justify-content:space-between;font-size:13px}` +
        `.sign div{width:45%}.line{margin-top:26px;border-top:1px solid #333;padding-top:4px;color:#555}` +
        `@media print{body{margin:12mm}}</style></head><body>` +
        `<h1>Заявка на закупку${number ? ` № ${escapeHtml(number)}` : ''}</h1>` +
        `<div class="meta">Дата: ${escapeHtml(dateStr)}${supplierName ? ` &nbsp;·&nbsp; Поставщик: <b>${escapeHtml(supplierName)}</b>` : ''}` +
        `${note ? `<br>Примечание: ${escapeHtml(note)}` : ''}</div>` +
        `<table><thead><tr><th style="width:36px">№</th><th>Наименование</th><th style="width:56px">Ед.</th>` +
        `<th style="width:90px">Остаток</th><th style="width:64px">Мин.</th><th style="width:90px">Заказать</th></tr></thead>` +
        `<tbody>${rowsHtml}</tbody>` +
        `<tfoot><tr><td colspan="5" class="r">Позиций: ${items.length}, всего единиц:</td><td class="r b">${totalQty}</td></tr></tfoot>` +
        `</table>` +
        `<div class="sign"><div class="line">Составил (ФИО, подпись)</div><div class="line">Утвердил (ФИО, подпись)</div></div>` +
        `</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  // Сохранить заявку (в историю, с номером) и сразу распечатать накладную
  async function saveAndPrintRequest() {
    if (reqRows.length === 0) return;
    const supplier = suppliers.find((s) => s.id === reqSupplierId);
    try {
      const saved = await api.post('/purchasing/requests', {
        companyId: cid,
        supplierName: supplier?.name,
        note: reqNote || undefined,
        items: reqRows.map((r) => ({
          productId: r.productId,
          name: r.name,
          unit: r.unit,
          stock: r.stock,
          minStock: r.minStock,
          quantity: Number(r.quantity) || 0,
        })),
      });
      openRequestPrint(
        saved.number,
        new Date(saved.createdAt).toLocaleDateString('ru-RU'),
        saved.supplierName,
        saved.note,
        Array.isArray(saved.items) ? saved.items : [],
      );
      setReqRows([]);
      setReqNote('');
      setReqSupplierId('');
      load();
    } catch (err: any) {
      alert('Не удалось сохранить заявку: ' + (err?.message ?? err));
    }
  }

  // Повторная печать сохранённой заявки из истории
  function printSaved(req: any) {
    openRequestPrint(
      req.number,
      new Date(req.createdAt).toLocaleDateString('ru-RU'),
      req.supplierName,
      req.note,
      Array.isArray(req.items) ? req.items : [],
    );
  }

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
    { key: 'request', label: 'Заявка на закупку', count: deficit.length },
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

      {/* ============ ЗАЯВКА НА ЗАКУПКУ ============ */}
      {tab === 'request' && (
        <div className="space-y-6">
          {/* Дефицит на складе — источник для заявки */}
          <TableCard>
            <Toolbar>
              <SectionTitle className="mb-0">Дефицит на складе</SectionTitle>
              <div className="flex gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
                {([
                  { k: 'all', l: `Все (${deficit.length})` },
                  { k: 'low', l: 'Заканчиваются' },
                  { k: 'out', l: 'Отсутствуют' },
                ] as const).map((f) => (
                  <button
                    key={f.k}
                    onClick={() => setReqFilter(f.k)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      reqFilter === f.k
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    {f.l}
                  </button>
                ))}
              </div>
              {canManage && (
                <Button size="sm" onClick={addAllDeficit} disabled={deficitFiltered.length === 0} className="ml-auto">
                  <NavIcon name="plus" className="h-4 w-4" />Добавить всё в заявку
                </Button>
              )}
            </Toolbar>
            {deficitFiltered.length === 0 ? (
              <EmptyState icon="check" title="Дефицита нет" hint="Всех товаров достаточно (остаток выше минимума)." />
            ) : (
              <div className="pp-table-scroll">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Ед.</th>
                      <th className="text-right">Остаток</th>
                      <th className="text-right">Мин.</th>
                      <th>Статус</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {deficitFiltered.map(({ p, st, min }) => {
                      const out = st <= 0;
                      return (
                        <tr key={p.id}>
                          <td className="font-medium text-slate-700 dark:text-slate-200">{p.name}</td>
                          <td className="text-slate-500 dark:text-slate-400">{p.unit?.shortName ?? '—'}</td>
                          <td className={`text-right font-semibold ${out ? 'text-rose-600' : 'text-amber-600'}`}>{st}</td>
                          <td className="text-right text-slate-400">{min || '—'}</td>
                          <td>
                            <Badge tone={out ? 'rose' : 'amber'}>{out ? 'Отсутствует' : 'Заканчивается'}</Badge>
                          </td>
                          <td className="text-right">
                            {canManage &&
                              (reqInList(p.id) ? (
                                <span className="text-xs text-emerald-600 dark:text-emerald-400">в заявке ✓</span>
                              ) : (
                                <Button size="sm" variant="ghost" onClick={() => addReq(p)}>
                                  <NavIcon name="plus" className="h-4 w-4" />В заявку
                                </Button>
                              ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TableCard>

          {/* Сама заявка + печать */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle className="mb-0">Заявка на закупку</SectionTitle>
              {reqRows.length > 0 && (
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  Позиций: <b className="text-slate-700 dark:text-slate-200">{reqRows.length}</b>, единиц:{' '}
                  <b className="text-slate-700 dark:text-slate-200">{reqTotalQty}</b>
                </span>
              )}
            </div>

            {/* Поиск любого товара для добавления в заявку */}
            <div className="relative mb-3">
              <SearchInput
                value={reqQuery}
                onChange={setReqQuery}
                placeholder="Найти товар и добавить в заявку (название, артикул, штрихкод)…"
                className="max-w-none"
              />
              {reqMatches.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  {reqMatches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addReq(p)}
                      className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-700/60"
                    >
                      <span className="truncate font-medium text-slate-700 dark:text-slate-200">{p.name}</span>
                      <span className="shrink-0 text-xs text-slate-400">остаток {stockTotal(p)}</span>
                    </button>
                  ))}
                </div>
              )}
              {rq && reqMatches.length === 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  Ничего не найдено
                </div>
              )}
            </div>

            {reqRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                Добавьте товары из списка дефицита выше или через поиск.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex gap-2 px-1 text-xs font-medium text-slate-400">
                    <span className="flex-1">Товар</span>
                    <span className="w-20 text-center">Остаток</span>
                    <span className="w-24 text-center">Заказать</span>
                    <span className="w-6" />
                  </div>
                  {reqRows.map((r, i) => (
                    <div key={r.productId} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{r.name}</div>
                        <div className="text-xs text-slate-400">
                          {r.unit ? `ед: ${r.unit}` : ''}{r.minStock ? ` · мин: ${r.minStock}` : ''}
                        </div>
                      </div>
                      <div className="w-20 text-center text-sm tabular-nums text-slate-500">{r.stock}</div>
                      <Input
                        value={r.quantity}
                        onChange={(e) => setReqRow(i, { quantity: e.target.value })}
                        type="number"
                        min="1"
                        step="1"
                        className="w-24 text-right"
                      />
                      <button
                        type="button"
                        aria-label="Удалить"
                        onClick={() => removeReqRow(i)}
                        className="inline-flex w-6 shrink-0 items-center justify-center text-slate-400 dark:text-slate-500 hover:text-rose-600"
                      >
                        <NavIcon name="close" className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Поставщик (необязательно)">
                    <Select value={reqSupplierId} onChange={(e) => setReqSupplierId(e.target.value)}>
                      <option value="">— не указан —</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Примечание">
                    <Input value={reqNote} onChange={(e) => setReqNote(e.target.value)} placeholder="напр. срочно, до пятницы" />
                  </Field>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <Button variant="ghost" onClick={() => { setReqRows([]); setReqNote(''); setReqSupplierId(''); }}>
                    Очистить
                  </Button>
                  <Button onClick={saveAndPrintRequest} className="ml-auto">
                    <NavIcon name="print" className="h-4 w-4" />Сохранить и печатать
                  </Button>
                </div>
              </>
            )}
          </Card>

          {/* История заявок — доказательство «что и когда заказывали» */}
          <TableCard>
            <Toolbar>
              <SectionTitle className="mb-0">История заявок</SectionTitle>
              <span className="text-sm text-slate-400">Всего: {requests.length}</span>
            </Toolbar>
            {requests.length === 0 ? (
              <EmptyState
                icon="purchasing"
                title="Заявок пока нет"
                hint="Составьте заявку выше и нажмите «Сохранить и печатать» — она попадёт в историю с номером и датой."
              />
            ) : (
              <div className="pp-table-scroll">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Номер</th>
                      <th>Дата и время</th>
                      <th>Поставщик</th>
                      <th className="text-right">Позиций</th>
                      <th className="text-right">Единиц</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id}>
                        <td className="font-medium text-slate-700 dark:text-slate-200">{r.number ?? '—'}</td>
                        <td className="text-slate-500 dark:text-slate-400">
                          {new Date(r.createdAt).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="text-slate-700 dark:text-slate-200">{r.supplierName ?? '—'}</td>
                        <td className="text-right text-slate-500 dark:text-slate-400">
                          {Array.isArray(r.items) ? r.items.length : 0}
                        </td>
                        <td className="text-right font-medium text-slate-800 dark:text-slate-100">
                          {Number(r.totalQty) || 0}
                        </td>
                        <td className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => printSaved(r)}>
                            <NavIcon name="print" className="h-4 w-4" />Печать
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TableCard>
        </div>
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
