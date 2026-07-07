'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { API_BASE, SERVER_ORIGIN, DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  TableCard,
  Toolbar,
  SearchInput,
  Tabs,
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

const STATUS_LABELS: Record<string, string> = {
  TODO: 'Нужно создать',
  IN_PROGRESS: 'В работе',
  SENT: 'На согласовании',
  REVISION: 'Требуется доработка',
  APPROVED: 'Утверждён',
  REJECTED: 'Отклонён',
};
const STATUS_TONES: Record<string, Tone> = {
  TODO: 'slate', IN_PROGRESS: 'sky', SENT: 'violet',
  REVISION: 'amber', APPROVED: 'emerald', REJECTED: 'rose',
};
const TYPE_LABELS: Record<string, string> = {
  SALE: 'Продажа', PRINT: 'Печать', REPAIR: 'Ремонт', RECOVERY: 'Восстановление',
};

// Переходы статуса (кнопки действий в панели)
const MOVES: Record<string, { to: string; label: string; variant: any }[]> = {
  TODO: [{ to: 'IN_PROGRESS', label: 'В работу', variant: 'sky' }],
  IN_PROGRESS: [{ to: 'SENT', label: 'Отправить клиенту', variant: 'primary' }],
  SENT: [
    { to: 'APPROVED', label: 'Согласован', variant: 'emerald' },
    { to: 'REVISION', label: 'Запросить доработку', variant: 'amber' },
    { to: 'REJECTED', label: 'Отклонить', variant: 'danger' },
  ],
  REVISION: [{ to: 'IN_PROGRESS', label: 'В работу', variant: 'sky' }],
  APPROVED: [{ to: 'IN_PROGRESS', label: 'Вернуть в работу', variant: 'ghost' }],
  REJECTED: [{ to: 'IN_PROGRESS', label: 'Вернуть в работу', variant: 'sky' }],
};

// Чек-лист перед печатью (хранится в поле checklist макета)
const CHECKLIST: { k: string; l: string }[] = [
  { k: 'format', l: 'Формат соответствует заказу' },
  { k: 'cmyk', l: 'Цветовая модель CMYK' },
  { k: 'bleed', l: 'Вылеты 3 мм' },
  { k: 'fonts', l: 'Шрифты переведены в кривые' },
  { k: 'dpi', l: 'Разрешение 300 DPI' },
  { k: 'imagesCmyk', l: 'Все изображения в CMYK' },
  { k: 'noErrors', l: 'Нет ошибок и опечаток' },
  { k: 'clientApproved', l: 'Клиент согласовал' },
];

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' c.';
}
function isImage(url?: string) {
  return !!url && /\.(png|jpe?g|webp|gif|svg)$/i.test(url);
}
function dueLabel(deadline?: string): { text: string; danger: boolean } {
  if (!deadline) return { text: '—', danger: false };
  const d = new Date(deadline);
  const days = Math.ceil((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days < 0) return { text: 'просрочено', danger: true };
  if (days === 0) return { text: 'сегодня', danger: true };
  if (days === 1) return { text: 'завтра', danger: false };
  return { text: `через ${days} дн.`, danger: false };
}

export default function DesignPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { user, can } = useAuth();
  const canManage = can('design.manage');

  const [proofs, setProofs] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const [tab, setTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [fDesigner, setFDesigner] = useState('');

  const [selected, setSelected] = useState<any | null>(null);
  const [comment, setComment] = useState('');

  // Создание
  const [showAdd, setShowAdd] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [msg, setMsg] = useState('');

  const uploadFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function load() {
    api.get(`/design?companyId=${cid}`).then((list) => {
      setProofs(list);
      // обновить открытую панель свежими данными
      setSelected((cur: any) => (cur ? list.find((p: any) => p.id === cur.id) ?? null : null));
    }).catch(() => {});
  }
  useEffect(() => {
    load();
    if (canManage) {
      api.get(`/orders?companyId=${cid}&pageSize=100`).then((r) => setOrders(r.items ?? [])).catch(() => {});
      if (can('users.view')) api.get(`/users?companyId=${cid}`).then(setUsers).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  function openDrawer(p: any) {
    setSelected(p);
    setComment(p.comment ?? '');
  }

  async function createProof(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    try {
      await api.post('/design', { companyId: cid, orderId, title: title || undefined, assignedUserId: assignee || undefined });
      setOrderId(''); setTitle(''); setAssignee('');
      setShowAdd(false);
      setMsg('✓ Макет добавлен');
      load();
    } catch (err: any) { setMsg('Ошибка: ' + err.message); }
  }

  async function setStatus(id: string, status: string) {
    let cmt: string | undefined;
    if (status === 'REVISION') cmt = prompt('Что нужно поправить?') ?? undefined;
    await api.patch(`/design/${id}/status`, { status, comment: cmt });
    load();
  }

  async function saveComment() {
    if (!selected) return;
    await api.patch(`/design/${selected.id}`, { comment });
    load();
  }

  async function toggleCheck(k: string) {
    if (!selected) return;
    const cur = selected.checklist ?? {};
    const next = { ...cur, [k]: !cur[k] };
    setSelected({ ...selected, checklist: next });
    setProofs((ps) => ps.map((p) => (p.id === selected.id ? { ...p, checklist: next } : p)));
    try { await api.patch(`/design/${selected.id}`, { checklist: next }); } catch {}
  }

  function pickFile(proofId: string) {
    uploadFor.current = proofId;
    fileInput.current?.click();
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const proofId = uploadFor.current;
    e.target.value = '';
    if (!file || !proofId) return;
    setMsg('Загрузка файла…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/public/upload`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`Ошибка загрузки ${res.status}`);
      const data = await res.json();
      await api.patch(`/design/${proofId}`, { fileUrl: data.url, fileName: data.name });
      setMsg('✓ Файл загружен (новая версия)');
      load();
    } catch (err: any) { setMsg('Ошибка загрузки: ' + err.message); }
  }

  async function remove(id: string) {
    if (!confirm('Удалить макет?')) return;
    await api.del(`/design/${id}`);
    if (selected?.id === id) setSelected(null);
    load();
  }

  // ---- производные ----
  const cnt = (s: string) => proofs.filter((p) => p.status === s).length;
  const workCount = proofs.filter((p) => p.status === 'IN_PROGRESS' || p.status === 'TODO').length;
  const tabs = [
    { key: 'ALL', label: 'Все', count: proofs.length },
    { key: 'mine', label: 'Мои', count: proofs.filter((p) => p.assignedUserId === user?.id).length },
    { key: 'SENT', label: 'На согласовании', count: cnt('SENT') },
    { key: 'work', label: 'В работе', count: workCount },
    { key: 'APPROVED', label: 'Утверждённые', count: cnt('APPROVED') },
    { key: 'REVISION', label: 'На правку', count: cnt('REVISION') },
    { key: 'REJECTED', label: 'Архив', count: cnt('REJECTED') },
  ];

  const ql = search.trim().toLowerCase();
  const filtered = proofs.filter((p) => {
    if (tab === 'mine' ? p.assignedUserId !== user?.id
      : tab === 'work' ? !(p.status === 'IN_PROGRESS' || p.status === 'TODO')
      : tab !== 'ALL' && p.status !== tab) return false;
    if (fDesigner && p.assignedUserId !== fDesigner) return false;
    if (ql && !`№${p.order?.orderNumber} ${p.title ?? ''} ${p.order?.client?.fullName ?? ''}`.toLowerCase().includes(ql)) return false;
    return true;
  });

  const typeOf = (p: any) => p.order?.items?.[0]?.description || TYPE_LABELS[p.order?.orderType] || p.order?.orderType || '—';

  return (
    <div>
      <input ref={fileInput} type="file" className="hidden" onChange={onFile} />

      <PageHeader
        icon="design"
        title="Дизайн и макеты"
        subtitle="Управляйте макетами, версиями и согласованием с клиентами"
        actions={canManage && <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? 'Отмена' : '+ Новый макет'}</Button>}
      />

      <StatGrid cols={4}>
        <StatCard icon="design" tone="indigo" label="Всего макетов" value={proofs.length} highlight />
        <StatCard icon="production" tone="sky" label="В работе" value={workCount} />
        <StatCard icon="complaints" tone="amber" label="На правку" value={cnt('REVISION')} />
        <StatCard icon="reports" tone="emerald" label="Согласовано" value={cnt('APPROVED')} />
      </StatGrid>

      {showAdd && canManage && (
        <Card className="mb-6">
          <SectionTitle>Новый макет</SectionTitle>
          <form onSubmit={createProof} className="flex flex-wrap items-end gap-3">
            <Field label="Заказ" className="min-w-[220px] flex-1">
              <Select value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
                <option value="">— выберите заказ —</option>
                {orders.map((o) => <option key={o.id} value={o.id}>№{o.orderNumber} · {o.client?.fullName ?? o.client?.phone ?? 'без клиента'}</option>)}
              </Select>
            </Field>
            <Field label="Название" className="min-w-[160px]">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="напр. Визитка" />
            </Field>
            <Field label="Дизайнер" className="min-w-[160px]">
              <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">— не назначен —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </Select>
            </Field>
            <Button type="submit">Добавить</Button>
            {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
          </form>
        </Card>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <TableCard>
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по макетам, заказам, клиентам…" />
          {can('users.view') && (
            <Select value={fDesigner} onChange={(e) => setFDesigner(e.target.value)} className="w-auto">
              <option value="">Все дизайнеры</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </Select>
          )}
          <span className="text-sm text-slate-400">Найдено: {filtered.length}</span>
        </Toolbar>

        {filtered.length === 0 ? (
          <EmptyState icon="design" title="Макетов нет" hint={canManage ? 'Добавьте макет кнопкой «+ Новый макет».' : undefined} />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Макет и заказ</th>
                  <th>Тип</th>
                  <th>Клиент</th>
                  <th>Дизайнер</th>
                  <th>Статус</th>
                  <th>Срок</th>
                  <th>Версия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const due = dueLabel(p.order?.deadline);
                  return (
                    <tr key={p.id} className="cursor-pointer" onClick={() => openDrawer(p)}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                            {isImage(p.fileUrl) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`${SERVER_ORIGIN}${p.fileUrl}`} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <NavIcon name="image" className="h-5 w-5 text-slate-300" />
                            )}
                          </span>
                          <span>
                            <span className="block text-xs font-semibold text-indigo-600 dark:text-indigo-400">Заказ №{p.order?.orderNumber}</span>
                            <span className="block font-medium text-slate-700 dark:text-slate-200">{p.title ?? 'Макет'}</span>
                            <span className="block text-xs text-slate-400">Создан: {new Date(p.createdAt).toLocaleDateString('ru-RU')}</span>
                          </span>
                        </div>
                      </td>
                      <td><Badge tone="indigo">{typeOf(p)}</Badge></td>
                      <td className="text-slate-600 dark:text-slate-300">{p.order?.client?.fullName ?? p.order?.client?.phone ?? '—'}</td>
                      <td className="text-slate-600 dark:text-slate-300">{p.assignedUser?.fullName ?? '—'}</td>
                      <td><Badge tone={STATUS_TONES[p.status] ?? 'slate'}>{STATUS_LABELS[p.status] ?? p.status}</Badge></td>
                      <td className="whitespace-nowrap">
                        <span className={due.danger ? 'font-medium text-rose-600' : 'text-slate-600 dark:text-slate-300'}>{due.text}</span>
                      </td>
                      <td className="text-slate-500">v{p.version}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      {/* ===================== ПАНЕЛЬ МАКЕТА ===================== */}
      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setSelected(null)} />
          <div className="relative z-10 h-full w-full max-w-lg overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Заказ №{selected.order?.orderNumber}</h2>
                <Badge tone={STATUS_TONES[selected.status] ?? 'slate'}>{STATUS_LABELS[selected.status]}</Badge>
              </div>
              <button aria-label="Закрыть" onClick={() => setSelected(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><NavIcon name="close" className="h-4 w-4" /></button>
            </div>

            <div className="mb-1 text-base font-semibold text-slate-800 dark:text-slate-100">{selected.title ?? 'Макет'}</div>
            <div className="mb-3 text-sm text-slate-500">Тип макета: {typeOf(selected)} · версия v{selected.version}</div>

            {selected.fileUrl && (
              <div className="mb-3 flex gap-2">
                <a href={`${SERVER_ORIGIN}${selected.fileUrl}`} target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button variant="ghost" className="w-full"><NavIcon name="eye" className="h-4 w-4" />Открыть макет</Button>
                </a>
                <a href={`${SERVER_ORIGIN}${selected.fileUrl}`} download className="flex-1">
                  <Button variant="ghost" className="w-full"><NavIcon name="download" className="h-4 w-4" />Скачать</Button>
                </a>
              </div>
            )}

            {isImage(selected.fileUrl) && (
              <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${SERVER_ORIGIN}${selected.fileUrl}`} alt="Превью макета" className="max-h-56 w-full object-contain bg-slate-50 dark:bg-slate-800" />
              </div>
            )}

            {/* Информация о заказе */}
            <SectionTitle>Информация о заказе</SectionTitle>
            <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
              <Info label="Клиент" value={selected.order?.client?.fullName ?? '—'} />
              <Info label="Телефон" value={selected.order?.client?.phone ?? '—'} />
              <Info label="Менеджер" value={selected.order?.assignedUser?.fullName ?? '—'} />
              <Info label="Дизайнер" value={selected.assignedUser?.fullName ?? '—'} />
              <Info label="Срок сдачи" value={selected.order?.deadline ? new Date(selected.order.deadline).toLocaleDateString('ru-RU') : '—'} />
              <Info label="Создан" value={new Date(selected.createdAt).toLocaleDateString('ru-RU')} />
              <Info label="Сумма заказа" value={selected.order?.total != null ? money(selected.order.total) : '—'} />
              <Info label="Файл" value={selected.fileName ?? 'не загружен'} />
            </div>

            {/* Действия по статусу */}
            {canManage && (
              <>
                <SectionTitle>Действия</SectionTitle>
                <div className="mb-4 flex flex-wrap gap-2">
                  {(MOVES[selected.status] ?? []).map((m) => (
                    <Button key={m.to} variant={m.variant} size="sm" onClick={() => setStatus(selected.id, m.to)}>{m.label}</Button>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => pickFile(selected.id)}><NavIcon name="paperclip" className="h-4 w-4" />Загрузить версию</Button>
                  <Button variant="ghost" size="sm" className="text-rose-500" onClick={() => remove(selected.id)}>Удалить</Button>
                </div>
              </>
            )}

            {/* Чек-лист перед печатью */}
            <SectionTitle>Чек-лист перед печатью</SectionTitle>
            <div className="mb-4 space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              {CHECKLIST.map((c) => {
                const on = !!selected.checklist?.[c.k];
                return (
                  <label key={c.k} className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={on} disabled={!canManage} onChange={() => toggleCheck(c.k)} className="h-4 w-4 rounded" />
                    <span className={on ? 'text-slate-700 line-through dark:text-slate-300' : ''}>{c.l}</span>
                  </label>
                );
              })}
              <div className="border-t border-slate-100 pt-2 text-xs text-slate-400 dark:border-slate-700">
                Готово: {CHECKLIST.filter((c) => selected.checklist?.[c.k]).length} из {CHECKLIST.length}
              </div>
            </div>

            {/* Комментарий */}
            <SectionTitle>Комментарий</SectionTitle>
            {canManage ? (
              <div className="flex items-end gap-2">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  placeholder="Заметка / правки клиента…"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
                <Button size="sm" onClick={saveComment}>Сохранить</Button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{selected.comment || 'Комментариев нет.'}</p>
            )}

            {msg && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{msg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-medium text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  );
}
