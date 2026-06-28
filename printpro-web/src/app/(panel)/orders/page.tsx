'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID, SERVER_ORIGIN } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
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
import type { Tone } from '@/components/ui';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' c.';
}

const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: 'Новый',
  AWAITING_DESIGN: 'Ожидает макет',
  IN_DESIGN: 'В дизайне',
  DESIGN_APPROVAL: 'Макет на согласовании',
  DESIGN_APPROVED: 'Согласован',
  IN_PROGRESS: 'В производстве',
  READY: 'Готов',
  DELIVERED: 'Выдан',
  REWORK: 'Возврат / переделка',
  CANCELLED: 'Отменён',
};
const STATUS_FLOW = [
  'ACCEPTED',
  'AWAITING_DESIGN',
  'IN_DESIGN',
  'DESIGN_APPROVAL',
  'DESIGN_APPROVED',
  'IN_PROGRESS',
  'READY',
  'DELIVERED',
  'REWORK',
  'CANCELLED',
];
const STATUS_TONES: Record<string, Tone> = {
  ACCEPTED: 'indigo',
  AWAITING_DESIGN: 'violet',
  IN_DESIGN: 'violet',
  DESIGN_APPROVAL: 'violet',
  DESIGN_APPROVED: 'violet',
  IN_PROGRESS: 'amber',
  READY: 'emerald',
  DELIVERED: 'sky',
  REWORK: 'rose',
  CANCELLED: 'slate',
};
const PAY_LABELS: Record<string, string> = {
  UNPAID: 'Не оплачен',
  PARTIAL: 'Частично',
  PAID: 'Оплачен',
  DEBT: 'В долг',
};
const PAY_TONES: Record<string, Tone> = {
  UNPAID: 'slate',
  PARTIAL: 'amber',
  PAID: 'emerald',
  DEBT: 'rose',
};
const URGENCY_LABELS: Record<string, string> = {
  NORMAL: 'Обычная',
  URGENT: 'Срочно',
  EXPRESS: 'Экспресс',
};
const TYPE_LABELS: Record<string, string> = {
  SALE: 'Продажа',
  PRINT: 'Печать / дизайн',
  REPAIR: 'Ремонт',
  RECOVERY: 'Восстановление',
};
const CLIENT_TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL: 'Физлицо',
  COMPANY: 'Компания',
  REGULAR: 'Постоянный',
  VIP: 'VIP',
};
// Группировка наших статусов под карточки-показатели
const WORK_STATUSES = [
  'AWAITING_DESIGN',
  'IN_DESIGN',
  'DESIGN_APPROVAL',
  'DESIGN_APPROVED',
  'REWORK',
];

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function dueLabel(deadline?: string): { text: string; danger: boolean } {
  if (!deadline) return { text: '—', danger: false };
  const d = new Date(deadline);
  const days = Math.ceil(
    (new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000,
  );
  if (days < 0) return { text: 'просрочено', danger: true };
  if (days === 0) return { text: 'сегодня', danger: true };
  if (days === 1) return { text: 'завтра', danger: false };
  return { text: `через ${days} дн.`, danger: false };
}

function pageList(cur: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  if (cur > 3) out.push('…');
  for (let i = Math.max(2, cur - 1); i <= Math.min(totalPages - 1, cur + 1); i++)
    out.push(i);
  if (cur < totalPages - 2) out.push('…');
  out.push(totalPages);
  return out;
}

export default function OrdersPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('orders.manage');

  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fType, setFType] = useState('');
  const [fManager, setFManager] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [stats, setStats] = useState<any>(null);
  const [managers, setManagers] = useState<any[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');

  const [selected, setSelected] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [msg, setMsg] = useState('');

  const filterQuery = () =>
    `companyId=${cid}` +
    (search ? `&search=${encodeURIComponent(search)}` : '') +
    (fStatus ? `&status=${fStatus}` : '') +
    (fType ? `&orderType=${fType}` : '') +
    (fManager ? `&managerId=${fManager}` : '') +
    (fFrom ? `&dateFrom=${new Date(fFrom).toISOString()}` : '') +
    (fTo ? `&dateTo=${new Date(fTo + 'T23:59:59').toISOString()}` : '');

  function load() {
    api
      .get(`/orders?${filterQuery()}&page=${page}&pageSize=${pageSize}`)
      .then((r) => {
        setOrders(r.items ?? []);
        setTotal(r.total ?? 0);
      })
      .catch(() => {});
  }
  function loadStats() {
    api.get(`/orders/stats?${filterQuery()}`).then(setStats).catch(() => {});
  }

  useEffect(() => {
    api.get(`/users?companyId=${cid}`).then(setManagers).catch(() => {});
  }, [cid]);

  useEffect(() => {
    const t = setTimeout(() => {
      load();
      loadStats();
    }, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, page, pageSize, search, fStatus, fType, fManager, fFrom, fTo]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const byStatus = stats?.byStatus ?? {};
  const workCount = WORK_STATUSES.reduce((s, k) => s + (byStatus[k] ?? 0), 0);

  function resetFilters() {
    setFStatus(''); setFType(''); setFManager(''); setFFrom(''); setFTo('');
    setPage(1);
  }
  const activeFilters =
    [fStatus, fType, fManager, fFrom, fTo].filter(Boolean).length;

  function toggleSel(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleSelAll() {
    setSelectedIds((prev) =>
      prev.size === orders.length ? new Set() : new Set(orders.map((o) => o.id)),
    );
  }

  async function openOrder(id: string) {
    setMsg('');
    const full = await api.get(`/orders/${id}`);
    setSelected(full);
    setPayAmount(String(full.balanceDue));
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setMsg('');
    try {
      const updated = await api.post(`/orders/${selected.id}/payments`, {
        amount: Number(payAmount),
        method: payMethod,
      });
      setSelected(updated);
      setMsg('✓ Оплата проведена');
      load();
      loadStats();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function changeStatus(status: string) {
    if (!selected) return;
    setMsg('');
    try {
      const updated = await api.patch(`/orders/${selected.id}/status`, { status });
      setSelected(updated);
      load();
      loadStats();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function bulkChangeStatus(status: string) {
    if (!status || selectedIds.size === 0) return;
    if (!confirm(`Сменить статус у ${selectedIds.size} заказ(ов) на «${STATUS_LABELS[status]}»?`)) return;
    await Promise.all(
      [...selectedIds].map((id) =>
        api.patch(`/orders/${id}/status`, { status }).catch(() => {}),
      ),
    );
    setSelectedIds(new Set());
    setBulkStatus('');
    load();
    loadStats();
  }

  function exportCSV() {
    const rows = orders.filter((o) => selectedIds.size === 0 || selectedIds.has(o.id));
    downloadCSV(
      'orders.csv',
      ['№', 'Дата', 'Клиент', 'Тип', 'Статус', 'Сумма', 'Менеджер', 'Срок'],
      rows.map((o) => [
        o.orderNumber,
        new Date(o.createdAt).toLocaleString('ru-RU'),
        o.client?.fullName ?? o.client?.phone ?? '—',
        o.items?.[0]?.description || TYPE_LABELS[o.orderType] || o.orderType,
        STATUS_LABELS[o.status] ?? o.status,
        Number(o.total),
        o.assignedUser?.fullName ?? '—',
        o.deadline ? new Date(o.deadline).toLocaleDateString('ru-RU') : '—',
      ]),
    );
  }

  function notifyClient(order: any, channel: 'whatsapp' | 'telegram') {
    const phone = (order.client?.phone ?? '').replace(/\D/g, '');
    const due = Number(order.balanceDue) > 0;
    const text =
      `Здравствуйте${order.client?.fullName ? ', ' + order.client.fullName : ''}! ` +
      `Ваш заказ №${order.orderNumber} готов к выдаче.` +
      (due ? ` К оплате: ${order.balanceDue} c.` : '') +
      ` Спасибо, что выбрали нас!`;
    const url =
      channel === 'whatsapp'
        ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
        : `https://t.me/share/url?url=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function reorder() {
    if (!selected) return;
    setMsg('');
    try {
      const created = await api.post(`/orders/${selected.id}/reorder`);
      setMsg(`✓ Создан повторный заказ №${created.orderNumber}`);
      load();
      openOrder(created.id);
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function refund() {
    if (!selected) return;
    if (!confirm('Оформить возврат? Деньги вернутся из кассы, товар — на склад, заказ будет отменён.')) return;
    setMsg('');
    try {
      const updated = await api.post(`/orders/${selected.id}/refund`);
      setSelected(updated);
      setMsg('✓ Возврат оформлен');
      load();
      loadStats();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  const allChecked = orders.length > 0 && selectedIds.size === orders.length;

  return (
    <div>
      <PageHeader
        icon="orders"
        title="Заказы"
        subtitle={`Всего заказов: ${stats?.total ?? total}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={exportCSV}>⬇ Экспорт</Button>
            {canManage && (
              <Link href="/orders/new">
                <Button>+ Создать заказ</Button>
              </Link>
            )}
          </div>
        }
      />

      {/* Карточки-показатели */}
      <StatGrid cols={4}>
        <StatCard icon="orders" tone="indigo" label="Все заказы" value={stats?.total ?? '…'} highlight />
        <StatCard icon="quotes" tone="violet" label="Новые" value={byStatus.ACCEPTED ?? 0} />
        <StatCard icon="design" tone="amber" label="В работе" value={workCount} />
        <StatCard icon="production" tone="sky" label="На производстве" value={byStatus.IN_PROGRESS ?? 0} />
        <StatCard icon="reports" tone="emerald" label="Готовы к выдаче" value={byStatus.READY ?? 0} />
        <StatCard icon="clients" tone="slate" label="Выдано" value={byStatus.DELIVERED ?? 0} />
        <StatCard icon="cash" tone="emerald" label="Общая сумма" value={money(stats?.totalSum ?? 0)} />
      </StatGrid>

      <TableCard>
        {/* Панель фильтров */}
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(v) => { setPage(1); setSearch(v); }}
            placeholder="Поиск по №, клиенту, телефону…"
          />
          <Select value={fStatus} onChange={(e) => { setPage(1); setFStatus(e.target.value); }} className="w-auto">
            <option value="">Все статусы</option>
            {STATUS_FLOW.map((st) => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
          </Select>
          <Select value={fType} onChange={(e) => { setPage(1); setFType(e.target.value); }} className="w-auto">
            <option value="">Все типы</option>
            {Object.entries(TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Button
            variant={showFilters || activeFilters > 1 ? 'primary' : 'ghost'}
            onClick={() => setShowFilters((v) => !v)}
          >
            ⛃ Фильтры{activeFilters > 0 ? ` (${activeFilters})` : ''}
          </Button>
        </Toolbar>

        {showFilters && (
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-800/40">
            <Field label="Менеджер">
              <Select value={fManager} onChange={(e) => { setPage(1); setFManager(e.target.value); }} className="w-48">
                <option value="">Все менеджеры</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </Select>
            </Field>
            <Field label="Дата с">
              <Input type="date" value={fFrom} onChange={(e) => { setPage(1); setFFrom(e.target.value); }} className="w-auto" />
            </Field>
            <Field label="по">
              <Input type="date" value={fTo} onChange={(e) => { setPage(1); setFTo(e.target.value); }} className="w-auto" />
            </Field>
            {activeFilters > 0 && (
              <Button variant="ghost" onClick={resetFilters}>Сбросить</Button>
            )}
          </div>
        )}

        {/* Панель массовых операций */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-indigo-100 bg-indigo-50 px-4 py-2.5 text-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
            <span className="font-medium text-indigo-700 dark:text-indigo-300">Выбрано: {selectedIds.size}</span>
            {canManage && (
              <Select
                value={bulkStatus}
                onChange={(e) => { setBulkStatus(e.target.value); bulkChangeStatus(e.target.value); }}
                className="w-auto"
              >
                <option value="">Сменить статус…</option>
                {STATUS_FLOW.map((st) => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
              </Select>
            )}
            <Button variant="ghost" size="sm" onClick={exportCSV}>⬇ Экспорт выбранных</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Снять выбор</Button>
          </div>
        )}

        {orders.length === 0 ? (
          <EmptyState icon="orders" title="Заказов нет" hint="Измените фильтры или создайте новый заказ." />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input type="checkbox" checked={allChecked} onChange={toggleSelAll} className="h-4 w-4 rounded" />
                  </th>
                  <th>№ заказа</th>
                  <th>Дата</th>
                  <th>Клиент</th>
                  <th>Тип</th>
                  <th>Статус</th>
                  <th className="text-right">Сумма</th>
                  <th>Менеджер</th>
                  <th>Срок</th>
                  <th className="text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const due = dueLabel(o.deadline);
                  const qty = (o.items ?? []).reduce((s: number, it: any) => s + Number(it.quantity || 0), 0);
                  return (
                    <tr key={o.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(o.id)}
                          onChange={() => toggleSel(o.id)}
                          className="h-4 w-4 rounded"
                        />
                      </td>
                      <td>
                        <button onClick={() => openOrder(o.id)} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                          №{o.orderNumber}
                        </button>
                      </td>
                      <td className="whitespace-nowrap text-slate-500">
                        {new Date(o.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <div className="font-medium text-slate-700 dark:text-slate-200">{o.client?.fullName ?? o.client?.phone ?? '—'}</div>
                        {o.client?.type && <div className="text-xs text-slate-400">{CLIENT_TYPE_LABELS[o.client.type] ?? ''}</div>}
                      </td>
                      <td>
                        <div className="text-slate-700 dark:text-slate-200">{o.items?.[0]?.description || TYPE_LABELS[o.orderType] || o.orderType}</div>
                        {qty > 0 && <div className="text-xs text-slate-400">{qty} шт.</div>}
                      </td>
                      <td><Badge tone={STATUS_TONES[o.status] ?? 'slate'}>{STATUS_LABELS[o.status] ?? o.status}</Badge></td>
                      <td className="whitespace-nowrap text-right font-semibold text-slate-700 dark:text-slate-200">{money(o.total)}</td>
                      <td className="whitespace-nowrap text-slate-600 dark:text-slate-300">{o.assignedUser?.fullName ?? '—'}</td>
                      <td className="whitespace-nowrap">
                        <span className={due.danger ? 'font-medium text-rose-600' : 'text-slate-600 dark:text-slate-300'}>{due.text}</span>
                        {o.deadline && <div className="text-xs text-slate-400">{new Date(o.deadline).toLocaleDateString('ru-RU')}</div>}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openOrder(o.id)} title="Открыть">👁</Button>
                          <Link href={`/order-card?id=${o.id}`}><Button variant="ghost" size="sm" title="Тех-карта">🖨</Button></Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Пагинация */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-700/60">
          <div className="flex items-center gap-2 text-slate-500">
            <span>Показать по:</span>
            <Select value={String(pageSize)} onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }} className="w-auto py-1">
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </Select>
            <span className="ml-2">
              {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} из {total}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>‹</Button>
            {pageList(page, pages).map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="px-1 text-slate-400">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`h-8 min-w-8 rounded-lg px-2 text-sm font-medium transition ${
                    p === page ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {p}
                </button>
              ),
            )}
            <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>›</Button>
          </div>
        </div>
      </TableCard>

      {/* ===================== БОКОВАЯ ПАНЕЛЬ ЗАКАЗА ===================== */}
      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setSelected(null)} />
          <div className="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Заказ №{selected.orderNumber}</h2>
              <button onClick={() => setSelected(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              {canManage ? (
                <Select value={selected.status} onChange={(e) => changeStatus(e.target.value)} className="w-auto">
                  {STATUS_FLOW.map((st) => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
                </Select>
              ) : (
                <Badge tone={STATUS_TONES[selected.status] ?? 'slate'}>{STATUS_LABELS[selected.status]}</Badge>
              )}
              {canManage && <Button variant="ghost" size="sm" onClick={reorder}>↻ Повторить</Button>}
              <Link href={`/order-card?id=${selected.id}`}><Button variant="ghost" size="sm">🖨 Тех-карта</Button></Link>
            </div>

            <div className="mb-3 text-sm text-slate-600 dark:text-slate-300">
              Клиент: {selected.client?.fullName ?? selected.client?.phone ?? '—'}
            </div>

            {(selected.format || selected.colorMode || (selected.urgency && selected.urgency !== 'NORMAL') || selected.designer || selected.operator || selected.deadline) && (
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                {selected.urgency && selected.urgency !== 'NORMAL' && (
                  <Badge tone={selected.urgency === 'EXPRESS' ? 'rose' : 'amber'}>{URGENCY_LABELS[selected.urgency]}</Badge>
                )}
                {selected.format && <Badge tone="slate">Формат: {selected.format}</Badge>}
                {selected.colorMode && <Badge tone="slate">{selected.colorMode}</Badge>}
                {selected.designer && <Badge tone="violet">Дизайнер: {selected.designer.fullName}</Badge>}
                {selected.operator && <Badge tone="sky">Оператор: {selected.operator.fullName}</Badge>}
                {selected.deadline && (
                  <Badge tone="slate">Срок: {new Date(selected.deadline).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Badge>
                )}
              </div>
            )}

            <div className="mb-3 space-y-1">
              {selected.items?.map((it: any) => (
                <div key={it.id} className="flex justify-between border-b border-slate-100 py-1.5 text-sm dark:border-slate-700/60">
                  <span>{it.description || it.service?.name || it.product?.name || 'Позиция'} × {it.quantity}</span>
                  <span className="text-slate-500">{it.lineTotal} c.</span>
                </div>
              ))}
            </div>

            {selected.statusHistory?.length > 0 && (
              <details className="mb-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                <summary className="cursor-pointer text-xs font-medium text-slate-500">История статусов ({selected.statusHistory.length})</summary>
                <div className="mt-2 space-y-1">
                  {selected.statusHistory.map((h: any) => (
                    <div key={h.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600 dark:text-slate-300">{STATUS_LABELS[h.status] ?? h.status}{h.reason ? ` · ${h.reason}` : ''}</span>
                      <span className="shrink-0 text-slate-400">{h.userName} · {new Date(h.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {selected.files?.length > 0 && (
              <div className="mb-3">
                <div className="mb-1 text-xs font-medium text-slate-500">Файлы клиента</div>
                <div className="flex flex-wrap gap-2">
                  {selected.files.map((f: any) => (
                    <a key={f.id} href={`${SERVER_ORIGIN}${f.fileUrl}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300">
                      📎 {f.fileName ?? 'файл'}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4 space-y-1 text-sm">
              <Line label="Итого" value={`${selected.total} c.`} bold />
              <Line label="Оплачено" value={`${selected.paid} c.`} />
              <Line label="К оплате" value={`${selected.balanceDue} c.`} danger={Number(selected.balanceDue) > 0} />
              <div className="pt-1"><Badge tone={PAY_TONES[selected.paymentStatus] ?? 'slate'}>{PAY_LABELS[selected.paymentStatus]}</Badge></div>
            </div>

            {selected.client?.phone && (
              <div className="mb-4">
                <div className="mb-1.5 text-xs font-medium text-slate-500">Сообщить клиенту, что заказ готов</div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="emerald" size="sm" onClick={() => notifyClient(selected, 'whatsapp')}><span>📲</span> WhatsApp</Button>
                  <Button variant="sky" size="sm" onClick={() => notifyClient(selected, 'telegram')}><span>✈️</span> Telegram</Button>
                </div>
              </div>
            )}

            {can('cash.operate') && Number(selected.balanceDue) > 0 && (
              <form onSubmit={pay} className="flex items-end gap-2">
                <Field label="Сумма" className="flex-1">
                  <Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} type="number" />
                </Field>
                <Field label="Способ">
                  <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                    <option value="CASH">Наличные</option>
                    <option value="CARD">Карта</option>
                    <option value="QR">QR</option>
                    <option value="TRANSFER">Перевод</option>
                  </Select>
                </Field>
                <Button type="submit" variant="emerald">Принять</Button>
              </form>
            )}
            {can('cash.operate') && selected.status !== 'CANCELLED' && Number(selected.paid) > 0 && (
              <Button variant="danger" size="sm" className="mt-3" onClick={refund}>Оформить возврат</Button>
            )}

            {msg && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{msg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Line({ label, value, bold, danger }: { label: string; value: string; bold?: boolean; danger?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`${bold ? 'font-bold' : ''} ${danger ? 'text-rose-600' : 'text-slate-700 dark:text-slate-200'}`}>{value}</span>
    </div>
  );
}
