'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

const STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: 'Открыта', cls: 'bg-amber-100 text-amber-700' },
  IN_REVIEW: { label: 'На рассмотрении', cls: 'bg-sky-100 text-sky-700' },
  RESOLVED: { label: 'Решена', cls: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { label: 'Отклонена', cls: 'bg-rose-100 text-rose-700' },
  CLOSED: { label: 'Закрыта', cls: 'bg-slate-200 text-slate-600' },
};

export default function ComplaintsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const manage = can('clients.manage');

  const [list, setList] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get(`/complaints?companyId=${cid}`).then(setList).catch(() => {});
  }
  useEffect(load, [cid]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/complaints', {
        companyId: cid,
        title,
        description: description || undefined,
      });
      setTitle('');
      setDescription('');
      setMsg('✓ Рекламация зарегистрирована');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function setStatus(id: string, status: string) {
    let resolution: string | undefined;
    if (status === 'RESOLVED' || status === 'REJECTED') {
      const r = prompt(
        status === 'RESOLVED' ? 'Как решена?' : 'Причина отклонения:',
      );
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

  // Следующие действия по статусу (процесс: регистрация → рассмотрение → решение → закрытие)
  const actions: Record<string, { to: string; label: string; cls: string }[]> = {
    OPEN: [{ to: 'IN_REVIEW', label: 'На рассмотрение', cls: 'bg-sky-600' }],
    IN_REVIEW: [
      { to: 'RESOLVED', label: 'Решена', cls: 'bg-emerald-600' },
      { to: 'REJECTED', label: 'Отклонить', cls: 'bg-rose-600' },
    ],
    RESOLVED: [{ to: 'CLOSED', label: 'Закрыть', cls: 'bg-slate-600' }],
    REJECTED: [{ to: 'CLOSED', label: 'Закрыть', cls: 'bg-slate-600' }],
  };

  return (
    <div className="max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold text-slate-800">Рекламации</h1>
      <p className="mb-6 text-sm text-slate-500">
        Жалобы клиентов: регистрация → рассмотрение → решение → закрытие.
      </p>

      <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-700">Новая рекламация</h2>
        <form onSubmit={create} className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="Суть жалобы (напр. брак печати по заказу №…)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Подробности"
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-3">
            <button className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700">
              Зарегистрировать
            </button>
            {msg && <span className="text-sm text-slate-600">{msg}</span>}
          </div>
        </form>
      </div>

      {list.length === 0 ? (
        <p className="text-slate-400">Рекламаций нет.</p>
      ) : (
        <div className="space-y-2">
          {list.map((c) => {
            const st = STATUS[c.status] ?? STATUS.OPEN;
            return (
              <div key={c.id} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800">{c.title}</div>
                    {c.description && (
                      <div className="text-sm text-slate-500">{c.description}</div>
                    )}
                    {c.order && (
                      <div className="text-xs text-slate-400">
                        Заказ №{c.order.orderNumber}
                      </div>
                    )}
                    {c.resolution && (
                      <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                        Решение: {c.resolution}
                      </div>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${st.cls}`}>
                    {st.label}
                  </span>
                </div>
                {manage && (actions[c.status] || c.status !== 'CLOSED') && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(actions[c.status] ?? []).map((a) => (
                      <button
                        key={a.to}
                        onClick={() => setStatus(c.id, a.to)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium text-white ${a.cls}`}
                      >
                        {a.label}
                      </button>
                    ))}
                    <button
                      onClick={() => remove(c.id)}
                      className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-rose-600"
                    >
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
