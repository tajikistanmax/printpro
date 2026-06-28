'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

const STATUS: Record<string, { label: string; cls: string }> = {
  OPEN:      { label: 'Открыта',          cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  IN_REVIEW: { label: 'На рассмотрении',  cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  RESOLVED:  { label: 'Решена',           cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  REJECTED:  { label: 'Отклонена',        cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  CLOSED:    { label: 'Закрыта',          cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
};

const NEXT_ACTIONS: Record<string, { to: string; label: string; cls: string }[]> = {
  OPEN:      [{ to: 'IN_REVIEW', label: 'Взять в работу', cls: 'bg-sky-600 hover:bg-sky-700' }],
  IN_REVIEW: [
    { to: 'RESOLVED', label: '✓ Решена',    cls: 'bg-emerald-600 hover:bg-emerald-700' },
    { to: 'REJECTED', label: '✕ Отклонить', cls: 'bg-rose-600 hover:bg-rose-700' },
  ],
  RESOLVED:  [{ to: 'CLOSED', label: 'Закрыть', cls: 'bg-slate-600 hover:bg-slate-700' }],
  REJECTED:  [{ to: 'CLOSED', label: 'Закрыть', cls: 'bg-slate-600 hover:bg-slate-700' }],
};

const TABS = [
  { key: '', label: 'Все' },
  { key: 'OPEN', label: 'Открытые' },
  { key: 'IN_REVIEW', label: 'В работе' },
  { key: 'RESOLVED', label: 'Решённые' },
  { key: 'CLOSED', label: 'Закрытые' },
];

export default function ComplaintsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('clients.manage');

  const [list, setList] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [clients, setClients] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);

  // Форма
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [formMsg, setFormMsg] = useState('');

  function load() {
    const q = filter ? `?companyId=${cid}&status=${filter}` : `?companyId=${cid}`;
    api.get(`/complaints${q}`).then(setList).catch(() => {});
  }

  useEffect(() => { load(); }, [cid, filter]);

  useEffect(() => {
    if (showForm) {
      api.get(`/clients?companyId=${cid}&pageSize=200`).then((r) => setClients(r.items ?? [])).catch(() => {});
      api.get(`/orders?companyId=${cid}&pageSize=200`).then((r) => setOrders(r.items ?? [])).catch(() => {});
    }
  }, [showForm, cid]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setFormMsg('');
    try {
      await api.post('/complaints', {
        companyId: cid,
        title,
        description: description || undefined,
        clientId: clientId || undefined,
        orderId: orderId || undefined,
      });
      setTitle(''); setDescription(''); setClientId(''); setOrderId('');
      setShowForm(false);
      setFormMsg('✓ Рекламация зарегистрирована');
      load();
    } catch (err: any) { setFormMsg('Ошибка: ' + err.message); }
  }

  async function updateStatus(id: string, status: string) {
    let resolution: string | undefined;
    if (status === 'RESOLVED' || status === 'REJECTED') {
      const r = prompt(status === 'RESOLVED' ? 'Как решена? Опишите итог:' : 'Причина отклонения:');
      if (r === null) return;
      resolution = r || undefined;
    }
    await api.patch(`/complaints/${id}/status`, { status, resolution });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Удалить рекламацию?')) return;
    await api.del(`/complaints/${id}`);
    load();
  }

  const counts = list.reduce((acc, c) => { acc[c.status] = (acc[c.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const openCount = (counts['OPEN'] ?? 0) + (counts['IN_REVIEW'] ?? 0);

  return (
    <div>
      {/* Заголовок */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Рекламации</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Жалобы и претензии клиентов
            {openCount > 0 && (
              <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                {openCount} активных
              </span>
            )}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {showForm ? 'Отмена' : '+ Новая рекламация'}
          </button>
        )}
      </div>

      {/* Форма добавления */}
      {showForm && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Новая рекламация</h2>
          <form onSubmit={create} className="space-y-3">
            <input
              value={title} onChange={(e) => setTitle(e.target.value)} required
              placeholder="Суть претензии (напр. Брак печати, заказ №…) *"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Подробности, что не так, что клиент ожидает"
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Клиент (необязательно)</label>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="">— не указан —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName ?? 'Без имени'} · {c.phone}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Заказ (необязательно)</label>
                <select value={orderId} onChange={(e) => setOrderId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="">— не указан —</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      №{o.orderNumber} · {o.client?.fullName ?? o.client?.phone ?? '—'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                Зарегистрировать
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="text-sm text-slate-400 hover:text-slate-600">
                Отмена
              </button>
              {formMsg && <span className="text-sm text-slate-600">{formMsg}</span>}
            </div>
          </form>
        </div>
      )}

      {/* Фильтр по статусу */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              filter === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-600 shadow-sm hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300'
            }`}>
            {t.label}
            {t.key === '' && list.length > 0 && (
              <span className="ml-1.5 text-xs opacity-60">{list.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Список рекламаций */}
      {list.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-slate-900">
          <p className="text-slate-400">
            {filter ? 'Рекламаций с этим статусом нет.' : 'Рекламаций нет. Это хорошо! 👍'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((c) => {
            const st = STATUS[c.status] ?? STATUS.OPEN;
            const nextActions = NEXT_ACTIONS[c.status] ?? [];
            return (
              <div key={c.id} className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {/* Заголовок + статус */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{c.title}</span>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>
                        {st.label}
                      </span>
                    </div>

                    {/* Описание */}
                    {c.description && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{c.description}</p>
                    )}

                    {/* Мета: клиент / заказ / дата */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                      {c.client && (
                        <span>
                          👤 {c.client.fullName ?? 'Без имени'} · {c.client.phone}
                        </span>
                      )}
                      {c.order && (
                        <span>📋 Заказ №{c.order.orderNumber}</span>
                      )}
                      <span>
                        {new Date(c.createdAt).toLocaleString('ru-RU', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* Решение (если есть) */}
                    {c.resolution && (
                      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <span className="font-medium">Итог:</span> {c.resolution}
                      </div>
                    )}
                  </div>
                </div>

                {/* Действия */}
                {canManage && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
                    {nextActions.map((a) => (
                      <button key={a.to} onClick={() => updateStatus(c.id, a.to)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white ${a.cls}`}>
                        {a.label}
                      </button>
                    ))}
                    <button onClick={() => remove(c.id)}
                      className="ml-auto rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:text-rose-600 dark:hover:text-rose-400">
                      Удалить
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
