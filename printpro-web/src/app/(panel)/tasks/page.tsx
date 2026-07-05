'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  SectionTitle,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
  Tone,
} from '@/components/ui';

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Новая',
  IN_PROGRESS: 'В работе',
  DONE: 'Выполнена',
  CANCELLED: 'Отменена',
};
const STATUS_TONES: Record<string, Tone> = {
  NEW: 'slate',
  IN_PROGRESS: 'amber',
  DONE: 'emerald',
  CANCELLED: 'slate',
};

export default function TasksPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api.get(`/tasks?companyId=${cid}`).then(setTasks).catch(() => {});
  }, [cid]);

  const canViewUsers = can('users.view');

  useEffect(() => {
    load();
    if (canViewUsers) {
      api.get(`/users?companyId=${cid}`).then(setUsers).catch(() => {});
    }
  }, [cid, load, canViewUsers]);

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

  const countOf = (status: string) => tasks.filter((t) => t.status === status).length;

  return (
    <div>
      <PageHeader
        icon="tasks"
        title="Задачи"
        subtitle={`${tasks.length} задач · ${countOf('IN_PROGRESS')} в работе · ${countOf('DONE')} выполнено`}
      />

      <StatGrid cols={4}>
        <StatCard icon="tasks" tone="indigo" label="Всего задач" value={tasks.length} highlight />
        <StatCard icon="quotes" tone="slate" label="Новые" value={countOf('NEW')} />
        <StatCard icon="production" tone="amber" label="В работе" value={countOf('IN_PROGRESS')} />
        <StatCard icon="reports" tone="emerald" label="Выполнено" value={countOf('DONE')} />
      </StatGrid>

      {can('tasks.manage') && (
        <Card className="mb-6">
          <SectionTitle>Новая задача</SectionTitle>
          <form onSubmit={createTask} className="flex flex-wrap items-end gap-3">
            <Field label="Что сделать" className="flex-1 min-w-[240px]">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: подготовить визитки к печати"
                required
              />
            </Field>
            <Field label="Исполнитель" className="min-w-[180px]">
              <Select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">— не назначен —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit">Поставить</Button>
            {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
          </form>
        </Card>
      )}

      <div className="space-y-2">
        {tasks.length === 0 ? (
          <Card>
            <EmptyState icon="tasks" title="Задач пока нет" />
          </Card>
        ) : (
          tasks.map((t) => (
            <Card
              key={t.id}
              className="flex items-center justify-between p-4"
            >
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-100">{t.title}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  {t.assignedUser?.fullName ?? 'без исполнителя'}
                  {t.priority > 0 && ` · приоритет ${t.priority}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONES[t.status] ?? 'slate'}>
                  {STATUS_LABELS[t.status]}
                </Badge>
                {t.status === 'NEW' && (
                  <Button variant="amber" size="sm" onClick={() => setStatus(t.id, 'IN_PROGRESS')}>
                    В работу
                  </Button>
                )}
                {t.status === 'IN_PROGRESS' && (
                  <Button variant="emerald" size="sm" onClick={() => setStatus(t.id, 'DONE')}>
                    Выполнено
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
                  onClick={() => deleteTask(t.id)}
                >
                  Удалить
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
