'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { API_BASE, DEFAULT_COMPANY_ID, SERVER_ORIGIN } from '@/lib/config';
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
import NavIcon from '@/lib/NavIcons';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' c.';
}

const TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL: 'Физлицо', COMPANY: 'Компания', REGULAR: 'Постоянный', VIP: 'VIP',
};
const TYPE_TONES: Record<string, Tone> = {
  INDIVIDUAL: 'slate', COMPANY: 'sky', REGULAR: 'emerald', VIP: 'amber',
};
const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: 'Новый', AWAITING_DESIGN: 'Ожидает макет', IN_DESIGN: 'В дизайне',
  DESIGN_APPROVAL: 'На согласовании', DESIGN_APPROVED: 'Согласован',
  IN_PROGRESS: 'В производстве', READY: 'Готов', DELIVERED: 'Выдан',
  REWORK: 'Переделка', CANCELLED: 'Отменён',
};

const AV_BG = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4'];
function initials(name?: string) {
  const p = (name || '').trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?';
}
function avColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_BG[h % AV_BG.length];
}

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function pageList(cur: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  if (cur > 3) out.push('…');
  for (let i = Math.max(2, cur - 1); i <= Math.min(totalPages - 1, cur + 1); i++) out.push(i);
  if (cur < totalPages - 2) out.push('…');
  out.push(totalPages);
  return out;
}

export default function ClientsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('clients.manage');

  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [stats, setStats] = useState<any>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<any | null>(null);

  // Создание
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [cf, setCf] = useState({ fullName: '', phone: '', type: 'INDIVIDUAL', email: '', discount: '', creditLimit: '', address: '', inn: '' });
  const [createMsg, setCreateMsg] = useState('');

  // Редактирование (внутри панели)
  const [showEditForm, setShowEditForm] = useState(false);
  const [ef, setEf] = useState<any>({});
  const [editMsg, setEditMsg] = useState('');

  const [uploading, setUploading] = useState(false);
  const [fileMsg, setFileMsg] = useState('');

  function load() {
    const q =
      `companyId=${cid}&page=${page}&pageSize=${pageSize}` +
      (search ? `&search=${encodeURIComponent(search)}` : '') +
      (fType ? `&type=${fType}` : '') +
      (fStatus ? `&status=${fStatus}` : '');
    api.get(`/clients?${q}`)
      .then((r) => { setList(r.items ?? []); setTotal(r.total ?? 0); })
      .catch(() => {});
  }
  function loadStats() {
    api.get(`/clients/stats?companyId=${cid}`).then(setStats).catch(() => {});
  }

  useEffect(() => {
    const t = setTimeout(() => { load(); loadStats(); }, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, search, page, pageSize, fType, fStatus]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  function toggleSel(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleSelAll() {
    setSelectedIds((prev) => (prev.size === list.length ? new Set() : new Set(list.map((c) => c.id))));
  }
  function exportCSV() {
    const rows = list.filter((c) => selectedIds.size === 0 || selectedIds.has(c.id));
    downloadCSV(
      'clients.csv',
      ['Имя', 'Телефон', 'Email', 'Тип', 'Заказов', 'Сумма', 'Статус'],
      rows.map((c) => [
        c.fullName ?? '', c.phone ?? '', c.email ?? '', TYPE_LABELS[c.type] ?? c.type,
        c.ordersCount ?? 0, Number(c.ordersSum ?? 0),
        c.inactive ? 'Неактивный' : 'Активный',
      ]),
    );
  }

  async function openClient(id: string) {
    const full = await api.get(`/clients/${id}`);
    setSelected(full);
    setShowEditForm(false);
  }

  async function createClient(e: React.FormEvent) {
    e.preventDefault(); setCreateMsg('');
    try {
      await api.post('/clients', {
        companyId: cid,
        phone: cf.phone,
        fullName: cf.fullName || undefined,
        type: cf.type,
        email: cf.email || undefined,
        address: cf.address || undefined,
        inn: cf.inn || undefined,
        discount: cf.discount ? Number(cf.discount) : undefined,
        creditLimit: cf.creditLimit ? Number(cf.creditLimit) : undefined,
      });
      setCf({ fullName: '', phone: '', type: 'INDIVIDUAL', email: '', discount: '', creditLimit: '', address: '', inn: '' });
      setShowCreateForm(false);
      load(); loadStats();
    } catch (err: any) { setCreateMsg('Ошибка: ' + err.message); }
  }

  function openEdit() {
    if (!selected) return;
    setEf({
      fullName: selected.fullName ?? '',
      phone: selected.phone ?? '',
      type: selected.type,
      email: selected.email ?? '',
      address: selected.address ?? '',
      inn: selected.inn ?? '',
      discount: String(Number(selected.discount) || ''),
      creditLimit: String(Number(selected.creditLimit) || ''),
      note: selected.note ?? '',
    });
    setEditMsg('');
    setShowEditForm(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); setEditMsg('');
    if (!selected) return;
    try {
      await api.patch(`/clients/${selected.id}`, {
        fullName: ef.fullName || undefined,
        phone: ef.phone,
        type: ef.type,
        email: ef.email || undefined,
        address: ef.address || undefined,
        inn: ef.inn || undefined,
        discount: ef.discount ? Number(ef.discount) : 0,
        creditLimit: ef.creditLimit ? Number(ef.creditLimit) : 0,
        note: ef.note || undefined,
      });
      setShowEditForm(false);
      openClient(selected.id);
      load();
    } catch (err: any) { setEditMsg('Ошибка: ' + err.message); }
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setUploading(true); setFileMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = typeof window !== 'undefined' ? localStorage.getItem('pp_token') : null;
      const res = await fetch(`${API_BASE}/clients/${selected.id}/files`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!res.ok) throw new Error('Не удалось загрузить файл');
      await openClient(selected.id);
    } catch (err: any) { setFileMsg('Ошибка: ' + err.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function removeFile(fileId: string) {
    if (!selected) return;
    await api.del(`/clients/files/${fileId}`);
    openClient(selected.id);
  }

  const allChecked = list.length > 0 && selectedIds.size === list.length;

  return (
    <div>
      <PageHeader
        icon="clients"
        title="Клиенты"
        subtitle="Управляйте клиентской базой и историей взаимодействий"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={exportCSV}><NavIcon name="download" className="h-4 w-4" />Экспорт</Button>
            {canManage && (
              <Button
                variant={showCreateForm ? 'ghost' : 'primary'}
                onClick={() => { setShowCreateForm((v) => !v); setSelected(null); }}
              >
                {showCreateForm ? 'Отмена' : '+ Добавить клиента'}
              </Button>
            )}
          </div>
        }
      />

      <StatGrid cols={4}>
        <StatCard icon="clients" tone="indigo" label="Всего клиентов" value={stats?.total ?? total} highlight />
        <StatCard icon="staff" tone="sky" label="Новые за месяц" value={stats?.newThisMonth ?? '…'} />
        <StatCard icon="reports" tone="emerald" label="Активные" value={stats?.active ?? '…'} sub="заказ за 30 дней" />
        <StatCard icon="cash" tone="amber" label="Выручка от клиентов" value={money(stats?.revenue ?? 0)} />
      </StatGrid>

      {/* Форма создания */}
      {showCreateForm && canManage && (
        <Card className="mb-6">
          <SectionTitle>Новый клиент</SectionTitle>
          <form onSubmit={createClient} className="grid gap-3 md:grid-cols-2">
            <Input value={cf.fullName} onChange={(e) => setCf((f) => ({ ...f, fullName: e.target.value }))} placeholder="ФИО / название" />
            <Input value={cf.phone} onChange={(e) => setCf((f) => ({ ...f, phone: e.target.value }))} placeholder="Телефон *" required />
            <Select value={cf.type} onChange={(e) => setCf((f) => ({ ...f, type: e.target.value }))}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Input value={cf.email} onChange={(e) => setCf((f) => ({ ...f, email: e.target.value }))} type="email" placeholder="Email" />
            <Input value={cf.address} onChange={(e) => setCf((f) => ({ ...f, address: e.target.value }))} placeholder="Адрес" />
            <Input value={cf.inn} onChange={(e) => setCf((f) => ({ ...f, inn: e.target.value }))} placeholder="ИНН" />
            <Input value={cf.discount} onChange={(e) => setCf((f) => ({ ...f, discount: e.target.value }))} type="number" min="0" max="100" placeholder="Скидка, %" />
            <Input value={cf.creditLimit} onChange={(e) => setCf((f) => ({ ...f, creditLimit: e.target.value }))} type="number" min="0" placeholder="Кредитный лимит, c. (0 = без)" />
            <div className="md:col-span-2">
              <Button type="submit" variant="emerald" className="w-full">Сохранить</Button>
            </div>
            {createMsg && <p className="text-sm text-rose-600 md:col-span-2">{createMsg}</p>}
          </form>
        </Card>
      )}

      <TableCard>
        <Toolbar>
          <SearchInput value={search} onChange={(v) => { setPage(1); setSearch(v); }} placeholder="Поиск по имени, телефону, email…" />
          <Select value={fType} onChange={(e) => { setPage(1); setFType(e.target.value); }} className="w-auto">
            <option value="">Все типы</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={fStatus} onChange={(e) => { setPage(1); setFStatus(e.target.value); }} className="w-auto">
            <option value="">Все статусы</option>
            <option value="active">Активные</option>
            <option value="inactive">Неактивные</option>
          </Select>
          <span className="text-sm text-slate-400">Найдено: {total}</span>
        </Toolbar>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-indigo-100 bg-indigo-50 px-4 py-2.5 text-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
            <span className="font-medium text-indigo-700 dark:text-indigo-300">Выбрано: {selectedIds.size}</span>
            <Button variant="ghost" size="sm" onClick={exportCSV}><NavIcon name="download" className="h-4 w-4" />Экспорт выбранных</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Снять выбор</Button>
          </div>
        )}

        {list.length === 0 ? (
          <EmptyState icon="clients" title="Клиентов не найдено" hint="Измените фильтры или добавьте клиента." />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th className="w-10"><input type="checkbox" checked={allChecked} onChange={toggleSelAll} className="h-4 w-4 rounded" /></th>
                  <th>Клиент</th>
                  <th>Тип</th>
                  <th>Контакты</th>
                  <th className="text-right">Заказов</th>
                  <th className="text-right">Сумма</th>
                  <th>Статус</th>
                  <th className="text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td><input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSel(c.id)} className="h-4 w-4 rounded" /></td>
                    <td>
                      <button onClick={() => openClient(c.id)} className="flex items-center gap-3 text-left">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: avColor(c.fullName ?? c.phone ?? c.id) }}>
                          {initials(c.fullName ?? c.phone)}
                        </span>
                        <span>
                          <span className="block font-medium text-slate-700 hover:text-indigo-600 dark:text-slate-200">{c.fullName ?? 'Без имени'}</span>
                          {c.inn && <span className="block text-xs text-slate-400">ИНН {c.inn}</span>}
                        </span>
                      </button>
                    </td>
                    <td><Badge tone={TYPE_TONES[c.type] ?? 'slate'}>{TYPE_LABELS[c.type] ?? c.type}</Badge></td>
                    <td>
                      <div className="text-slate-600 dark:text-slate-300">{c.phone}</div>
                      {c.email && <div className="text-xs text-slate-400">{c.email}</div>}
                    </td>
                    <td className="text-right text-slate-600 dark:text-slate-300">{c.ordersCount ?? 0}</td>
                    <td className="text-right font-semibold text-slate-700 dark:text-slate-200">{money(c.ordersSum ?? 0)}</td>
                    <td>{c.inactive ? <Badge tone="slate">Неактивный</Badge> : <Badge tone="emerald">Активный</Badge>}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openClient(c.id)} title="Открыть" aria-label="Открыть"><NavIcon name="eye" className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
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
            <span className="ml-2">{total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} из {total}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Предыдущая страница">‹</Button>
            {pageList(page, pages).map((p, i) =>
              p === '…' ? <span key={`e${i}`} className="px-1 text-slate-400">…</span> : (
                <button key={p} onClick={() => setPage(p)} className={`h-8 min-w-8 rounded-lg px-2 text-sm font-medium transition ${p === page ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{p}</button>
              ),
            )}
            <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Следующая страница">›</Button>
          </div>
        </div>
      </TableCard>

      {/* ===================== ПАНЕЛЬ КЛИЕНТА ===================== */}
      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setSelected(null)} />
          <div className="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: avColor(selected.fullName ?? selected.phone ?? selected.id) }}>
                  {initials(selected.fullName ?? selected.phone)}
                </span>
                <div>
                  <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{selected.fullName ?? 'Без имени'}</h2>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={TYPE_TONES[selected.type] ?? 'slate'}>{TYPE_LABELS[selected.type]}</Badge>
                    {selected.stats?.inactive && <Badge tone="amber">неактивный</Badge>}
                  </div>
                </div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Закрыть" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><NavIcon name="close" className="h-4 w-4" /></button>
            </div>

            {showEditForm ? (
              <form onSubmit={saveEdit} className="grid gap-3 sm:grid-cols-2">
                <Field label="ФИО / название" className="sm:col-span-2">
                  <Input value={ef.fullName} onChange={(e) => setEf((f: any) => ({ ...f, fullName: e.target.value }))} />
                </Field>
                <Field label="Телефон *"><Input value={ef.phone} onChange={(e) => setEf((f: any) => ({ ...f, phone: e.target.value }))} required /></Field>
                <Field label="Тип">
                  <Select value={ef.type} onChange={(e) => setEf((f: any) => ({ ...f, type: e.target.value }))}>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="Email"><Input type="email" value={ef.email} onChange={(e) => setEf((f: any) => ({ ...f, email: e.target.value }))} /></Field>
                <Field label="ИНН"><Input value={ef.inn} onChange={(e) => setEf((f: any) => ({ ...f, inn: e.target.value }))} /></Field>
                <Field label="Адрес" className="sm:col-span-2"><Input value={ef.address} onChange={(e) => setEf((f: any) => ({ ...f, address: e.target.value }))} /></Field>
                <Field label="Скидка, %"><Input type="number" min="0" max="100" value={ef.discount} onChange={(e) => setEf((f: any) => ({ ...f, discount: e.target.value }))} /></Field>
                <Field label="Кредитный лимит, c."><Input type="number" min="0" value={ef.creditLimit} onChange={(e) => setEf((f: any) => ({ ...f, creditLimit: e.target.value }))} /></Field>
                <Field label="Примечание" className="sm:col-span-2"><Input value={ef.note} onChange={(e) => setEf((f: any) => ({ ...f, note: e.target.value }))} placeholder="Любые заметки о клиенте" /></Field>
                {editMsg && <p className="text-sm text-rose-600 sm:col-span-2">{editMsg}</p>}
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" className="flex-1">Сохранить</Button>
                  <Button type="button" variant="ghost" onClick={() => setShowEditForm(false)}>Отмена</Button>
                </div>
              </form>
            ) : (
              <>
                {canManage && (
                  <div className="mb-3">
                    <Button variant="ghost" size="sm" onClick={openEdit}><NavIcon name="edit" className="h-4 w-4" />Изменить</Button>
                  </div>
                )}
                <div className="mb-4 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                  <div className="flex items-center gap-1.5"><NavIcon name="phone" className="h-3.5 w-3.5 text-slate-400" />{selected.phone}</div>
                  {selected.email && <div className="flex items-center gap-1.5"><NavIcon name="mail" className="h-3.5 w-3.5 text-slate-400" />{selected.email}</div>}
                  {selected.address && <div className="flex items-center gap-1.5"><NavIcon name="pin" className="h-3.5 w-3.5 text-slate-400" />{selected.address}</div>}
                  {selected.inn && <div>ИНН: {selected.inn}</div>}
                  {Number(selected.discount) > 0 && <div className="text-emerald-600">Скидка: {selected.discount}%</div>}
                  {Number(selected.bonusPoints) > 0 && <div className="flex items-center gap-1.5 text-violet-600"><NavIcon name="gift" className="h-3.5 w-3.5" />Бонусы: {Number(selected.bonusPoints).toFixed(0)}</div>}
                  {Number(selected.creditLimit) > 0 && (
                    <div>
                      Кредитный лимит: {selected.creditLimit} c.
                      {selected.stats?.creditAvailable != null && (
                        <span className={selected.stats.creditAvailable < 0 ? 'ml-1 text-rose-600' : 'ml-1 text-slate-400'}>
                          (доступно {selected.stats.creditAvailable} c.)
                        </span>
                      )}
                    </div>
                  )}
                  {selected.note && <div className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-slate-500 dark:bg-slate-800"><NavIcon name="message" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{selected.note}</div>}
                </div>

                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Заказов" value={String(selected.stats.ordersCount)} />
                  <Stat label="Потрачено" value={money(selected.stats.totalSpent)} />
                  <Stat label="Ср. чек" value={money(selected.stats.avgCheck ?? 0)} />
                  <Stat label="Долг" value={money(selected.stats.totalDebt)} danger={selected.stats.totalDebt > 0} />
                </div>

                <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">История заказов</h3>
                {selected.orders.length === 0 ? (
                  <p className="text-sm text-slate-400">Заказов нет.</p>
                ) : (
                  <div className="max-h-60 space-y-1 overflow-auto">
                    {selected.orders.map((o: any) => (
                      <div key={o.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-700">
                        <span className="text-slate-600 dark:text-slate-300">
                          №{o.orderNumber} · <span className="text-slate-400">{STATUS_LABELS[o.status]}</span>
                          <span className="ml-1 text-xs text-slate-400">{new Date(o.createdAt).toLocaleDateString('ru-RU')}</span>
                        </span>
                        <span>
                          <span className="text-slate-700 dark:text-slate-200">{money(Number(o.total))}</span>
                          {Number(o.balanceDue) > 0 && <span className="ml-2 text-rose-600">долг {money(Number(o.balanceDue))}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Файлы</h3>
                  {canManage && (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                      {uploading ? 'Загрузка…' : <><NavIcon name="paperclip" className="h-3.5 w-3.5" />Загрузить</>}
                      <input type="file" onChange={uploadFile} disabled={uploading} className="hidden" />
                    </label>
                  )}
                </div>
                {fileMsg && <p className="mt-1 text-xs text-rose-600">{fileMsg}</p>}
                {!selected.files || selected.files.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-400">Файлов нет.</p>
                ) : (
                  <div className="mt-1 space-y-1">
                    {selected.files.map((f: any) => (
                      <div key={f.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800">
                        <a href={`${SERVER_ORIGIN}${f.fileUrl}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 truncate text-indigo-600 hover:underline"><NavIcon name="paperclip" className="h-3.5 w-3.5 shrink-0" />{f.fileName ?? 'файл'}</a>
                        {canManage && <button onClick={() => removeFile(f.id)} aria-label="Удалить" className="ml-2 inline-flex text-rose-400 hover:text-rose-600"><NavIcon name="close" className="h-3.5 w-3.5" /></button>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800">
      <div className={`font-bold ${danger ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}
