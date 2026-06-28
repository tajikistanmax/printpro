'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { API_BASE, SERVER_ORIGIN, DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

const STAGES: { key: string; label: string; color: string }[] = [
  { key: 'TODO', label: 'Нужно создать', color: 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/50' },
  { key: 'IN_PROGRESS', label: 'В работе', color: 'border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/20' },
  { key: 'SENT', label: 'У клиента', color: 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20' },
  { key: 'REVISION', label: 'Требует правки', color: 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20' },
  { key: 'APPROVED', label: 'Согласован', color: 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20' },
  { key: 'REJECTED', label: 'Отклонён', color: 'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/20' },
];

// Кнопки переходов для каждого статуса
const MOVES: Record<string, { to: string; label: string; cls: string }[]> = {
  TODO: [{ to: 'IN_PROGRESS', label: 'В работу', cls: 'bg-sky-600' }],
  IN_PROGRESS: [{ to: 'SENT', label: 'Клиенту', cls: 'bg-violet-600' }],
  SENT: [
    { to: 'APPROVED', label: 'Согласован', cls: 'bg-emerald-600' },
    { to: 'REVISION', label: 'На правку', cls: 'bg-amber-600' },
  ],
  REVISION: [{ to: 'IN_PROGRESS', label: 'В работу', cls: 'bg-sky-600' }],
  APPROVED: [],
  REJECTED: [],
};

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('pp_token') : null;
}

export default function DesignPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('design.manage');

  const [proofs, setProofs] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [orderId, setOrderId] = useState('');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [msg, setMsg] = useState('');
  const uploadFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function load() {
    api.get(`/design?companyId=${cid}`).then(setProofs).catch(() => {});
  }
  useEffect(() => {
    load();
    if (canManage) {
      api
        .get(`/orders?companyId=${cid}&pageSize=100`)
        .then((r) => setOrders(r.items ?? []))
        .catch(() => {});
      if (can('users.view')) {
        api.get(`/users?companyId=${cid}`).then(setUsers).catch(() => {});
      }
    }
  }, [cid]);

  async function createProof(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/design', {
        companyId: cid,
        orderId,
        title: title || undefined,
        assignedUserId: assignee || undefined,
      });
      setOrderId('');
      setTitle('');
      setAssignee('');
      setMsg('✓ Макет добавлен');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function setStatus(id: string, status: string) {
    let comment: string | undefined;
    if (status === 'REVISION') {
      comment = prompt('Что нужно поправить?') ?? undefined;
    }
    await api.patch(`/design/${id}/status`, { status, comment });
    load();
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
      const res = await fetch(`${API_BASE}/public/upload`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      await api.patch(`/design/${proofId}`, {
        fileUrl: data.url,
        fileName: data.name,
      });
      setMsg('✓ Файл загружен (новая версия)');
      load();
    } catch (err: any) {
      setMsg('Ошибка загрузки: ' + err.message);
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить макет?')) return;
    await api.del(`/design/${id}`);
    load();
  }

  const byStage = (key: string) => proofs.filter((p) => p.status === key);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800 dark:text-slate-100">Дизайн-макеты</h1>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={onFile}
      />

      {canManage && (
        <div className="mb-6 rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Новый макет</h2>
          <form onSubmit={createProof} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Заказ</label>
              <select
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
                required
              >
                <option value="">— выберите заказ —</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    №{o.orderNumber} ·{' '}
                    {o.client?.fullName ?? o.client?.phone ?? 'без клиента'}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px]">
              <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Название</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
                placeholder="напр. Визитка"
              />
            </div>
            <div className="min-w-[160px]">
              <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Дизайнер</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              >
                <option value="">— не назначен —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </div>
            <button className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700">
              Добавить
            </button>
            {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
          </form>
        </div>
      )}

      {/* Доска по статусам */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {STAGES.map((stage) => {
          const list = byStage(stage.key);
          return (
            <div key={stage.key} className={`rounded-2xl border ${stage.color} p-3`}>
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{stage.label}</span>
                <span className="rounded-full bg-white dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {list.length}
                </span>
              </div>
              <div className="space-y-2">
                {list.length === 0 ? (
                  <p className="px-1 py-3 text-sm text-slate-400 dark:text-slate-500">Пусто</p>
                ) : (
                  list.map((p) => (
                    <div key={p.id} className="rounded-xl bg-white dark:bg-slate-800 p-3 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          №{p.order?.orderNumber}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">v{p.version}</span>
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-300">
                        {p.title ?? 'макет'}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                        {p.order?.client?.fullName ??
                          p.order?.client?.phone ??
                          ''}
                        {p.assignedUser && ` · 👤 ${p.assignedUser.fullName}`}
                      </div>
                      {p.fileUrl && (
                        <a
                          href={`${SERVER_ORIGIN}${p.fileUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs text-indigo-600 hover:underline"
                        >
                          📎 {p.fileName ?? 'файл'}
                        </a>
                      )}
                      {p.comment && p.status === 'REVISION' && (
                        <div className="mt-1 rounded bg-amber-50 dark:bg-amber-900/20 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                          ✏ {p.comment}
                        </div>
                      )}
                      {canManage && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {MOVES[p.status]?.map((m) => (
                            <button
                              key={m.to}
                              onClick={() => setStatus(p.id, m.to)}
                              className={`rounded-lg px-2.5 py-1 text-xs font-medium text-white ${m.cls}`}
                            >
                              {m.label}
                            </button>
                          ))}
                          <button
                            onClick={() => pickFile(p.id)}
                            className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                          >
                            📎 Файл
                          </button>
                          <button
                            onClick={() => remove(p.id)}
                            className="px-1 text-xs text-slate-400 dark:text-slate-500 hover:text-rose-600"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
