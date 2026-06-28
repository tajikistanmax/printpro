'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Новая',
  IN_PROGRESS: 'В работе',
  DONE: 'Выполнена',
  CANCELLED: 'Отменена',
};
const STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  DONE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  CANCELLED: 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500',
};

export default function TasksPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get(`/tasks?companyId=${cid}`).then(setTasks).catch(() => {});
  }
  useEffect(() => {
    load();
    if (can('users.view')) {
      api.get(`/users?companyId=${cid}`).then(setUsers).catch(() => {});
    }
  }, [cid]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/tasks', {
        companyId: cid,
        title,
        assignedUserId: assignee || undefined,
      });
      setTitle('');
      setMsg('✓ Задача создана');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function setStatus(id: string, status: string) {
    await api.patch(`/tasks/${id}/status`, { status });
    load();
  }

  async function deleteTask(id: string) {
    if (!confirm('Удалить задачу?')) return;
    await api.del(`/tasks/${id}`);
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800 dark:text-slate-100">Задачи</h1>

      {can('tasks.manage') && (
        <div className="mb-6 rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">Новая задача</h2>
          <form onSubmit={createTask} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Что сделать</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                placeholder="Например: подготовить визитки к печати"
                required
              />
            </div>
            <div className="min-w-[180px]">
              <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">Исполнитель</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
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
              Поставить
            </button>
            {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
          </form>
        </div>
      )}

      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="text-slate-400 dark:text-slate-500">Задач пока нет.</p>
        ) : (
          tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-sm"
            >
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-100">{t.title}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  {t.assignedUser?.fullName ?? 'без исполнителя'}
                  {t.priority > 0 && ` · приоритет ${t.priority}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs ${STATUS_COLORS[t.status]}`}
                >
                  {STATUS_LABELS[t.status]}
                </span>
                {t.status === 'NEW' && (
                  <button
                    onClick={() => setStatus(t.id, 'IN_PROGRESS')}
                    className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600"
                  >
                    В работу
                  </button>
                )}
                {t.status === 'IN_PROGRESS' && (
                  <button
                    onClick={() => setStatus(t.id, 'DONE')}
                    className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Выполнено
                  </button>
                )}
                <button
                  onClick={() => deleteTask(t.id)}
                  className="rounded-lg px-2 py-1 text-xs text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
