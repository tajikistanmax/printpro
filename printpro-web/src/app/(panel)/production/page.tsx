'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { API_BASE, DEFAULT_COMPANY_ID, SERVER_ORIGIN } from '@/lib/config';
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
  Tone,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';

// Этапы производства по порядку
const STAGES: { key: string; label: string; color: string; tone: Tone }[] = [
  { key: 'PENDING', label: 'Ожидает', color: 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800', tone: 'slate' },
  { key: 'PRINTING', label: 'Печать', color: 'border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/20', tone: 'sky' },
  { key: 'CUTTING', label: 'Резка', color: 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20', tone: 'amber' },
  { key: 'BINDING', label: 'Брошюровка', color: 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20', tone: 'violet' },
  { key: 'PACKAGING', label: 'Упаковка', color: 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-900/20', tone: 'indigo' },
  { key: 'PAUSED', label: 'На паузе', color: 'border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-700', tone: 'slate' },
  { key: 'COMPLETED', label: 'Готово', color: 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20', tone: 'emerald' },
  { key: 'REWORK', label: 'Брак / переделка', color: 'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/20', tone: 'rose' },
];

// Следующий этап для кнопки «дальше»
const NEXT: Record<string, string> = {
  PENDING: 'PRINTING',
  PRINTING: 'CUTTING',
  CUTTING: 'BINDING',
  BINDING: 'PACKAGING',
  PACKAGING: 'COMPLETED',
};

export default function ProductionPage() {
  const cid = DEFAULT_COMPANY_ID;
  const { can } = useAuth();
  const canManage = can('production.manage');
  const canViewUsers = can('users.view');

  const [jobs, setJobs] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [orderId, setOrderId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [printer, setPrinter] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [equipment, setEquipment] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api.get(`/production?companyId=${cid}`).then(setJobs).catch(() => {});
  }, [cid]);

  useEffect(() => {
    load();
    if (canManage) {
      api
        .get(`/orders?companyId=${cid}&pageSize=100`)
        .then((r) => setOrders(r.items ?? []))
        .catch(() => {});
      api
        .get(`/equipment?companyId=${cid}&status=ACTIVE`)
        .then(setEquipment)
        .catch(() => {});
      if (canViewUsers) {
        api.get(`/users?companyId=${cid}`).then(setUsers).catch(() => {});
      }
    }
  }, [cid, load, canManage, canViewUsers]);

  async function createJob(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/production', {
        companyId: cid,
        orderId,
        assignedUserId: assignee || undefined,
        equipmentId: equipmentId || undefined,
        printer: equipmentId ? undefined : printer || undefined,
      });
      setOrderId('');
      setAssignee('');
      setPrinter('');
      setEquipmentId('');
      setMsg('✓ Задание создано');
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function setStatus(id: string, status: string) {
    // Сервер может отклонить переход бизнес-правилом — показываем ошибку и не
    // делаем load() при провале, иначе доска молча не двигается (P0-22).
    try {
      await api.patch(`/production/${id}/status`, { status });
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function sendRework(id: string) {
    const reason = prompt('Причина брака / переделки:');
    if (reason === null) return;
    try {
      await api.patch(`/production/${id}/status`, {
        status: 'REWORK',
        defectReason: reason || undefined,
      });
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  async function uploadPhoto(id: string, file: File) {
    // Проверяем res.ok — raw fetch не бросает на 401/413/500, и без этого сбой
    // загрузки проглатывался: фото молча не появлялось (P0-21).
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('pp_token') : null;
      const res = await fetch(`${API_BASE}/production/${id}/photo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!res.ok) throw new Error(`загрузка не удалась (${res.status})`);
      load();
    } catch (err: any) {
      setMsg('Ошибка загрузки фото: ' + err.message);
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить задание?')) return;
    try {
      await api.del(`/production/${id}`);
      load();
    } catch (err: any) {
      setMsg('Ошибка: ' + err.message);
    }
  }

  const byStage = (key: string) => jobs.filter((j) => j.status === key);

  const activeCount = jobs.filter(
    (j) => j.status !== 'COMPLETED' && j.status !== 'REWORK' && j.status !== 'CANCELLED',
  ).length;
  const completedCount = byStage('COMPLETED').length;
  const reworkCount = byStage('REWORK').length;

  return (
    <div>
      <PageHeader
        icon="production"
        title="Производство"
        subtitle={`${jobs.length} заданий · ${activeCount} в работе`}
      />

      <StatGrid cols={4}>
        <StatCard icon="production" tone="indigo" label="Всего заданий" value={jobs.length} highlight />
        <StatCard icon="orders" tone="sky" label="В работе" value={activeCount} />
        <StatCard icon="reports" tone="emerald" label="Готово" value={completedCount} />
        <StatCard icon="complaints" tone="rose" label="Брак / переделка" value={reworkCount} />
      </StatGrid>

      {canManage && (
        <Card className="mb-6">
          <SectionTitle>Запустить заказ в производство</SectionTitle>
          <form onSubmit={createJob} className="flex flex-wrap items-end gap-3">
            <Field label="Заказ" className="min-w-[220px] flex-1">
              <Select
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                required
              >
                <option value="">— выберите заказ —</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    №{o.orderNumber} ·{' '}
                    {o.client?.fullName ?? o.client?.phone ?? 'без клиента'}
                  </option>
                ))}
              </Select>
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
            <Field label="Оборудование" className="min-w-[170px]">
              {equipment.length > 0 ? (
                <Select
                  value={equipmentId}
                  onChange={(e) => setEquipmentId(e.target.value)}
                >
                  <option value="">— не выбрано —</option>
                  {equipment.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={printer}
                  onChange={(e) => setPrinter(e.target.value)}
                  placeholder="напр. Roland"
                />
              )}
            </Field>
            <Button type="submit">В работу</Button>
            {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
          </form>
        </Card>
      )}

      {/* Доска по этапам */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {STAGES.map((stage) => {
          const list = byStage(stage.key);
          return (
            <div
              key={stage.key}
              className={`rounded-2xl border ${stage.color} p-3`}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{stage.label}</span>
                <Badge tone={stage.tone}>{list.length}</Badge>
              </div>
              <div className="space-y-2">
                {list.length === 0 ? (
                  <p className="px-1 py-3 text-sm text-slate-400 dark:text-slate-500">Пусто</p>
                ) : (
                  list.map((j) => (
                    <div
                      key={j.id}
                      className="rounded-xl bg-white dark:bg-slate-800 p-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          №{j.order?.orderNumber}
                        </span>
                        {j.priority > 0 && (
                          <Badge tone="rose">приоритет</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                        {j.order?.client?.fullName ??
                          j.order?.client?.phone ??
                          'без клиента'}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400 dark:text-slate-500">
                        {j.assignedUser && <span className="inline-flex items-center gap-1"><NavIcon name="user" className="h-3.5 w-3.5" />{j.assignedUser.fullName}</span>}
                        {(j.equipment?.name || j.printer) && (
                          <span className="inline-flex items-center gap-1"><NavIcon name="print" className="h-3.5 w-3.5" />{j.equipment?.name ?? j.printer}</span>
                        )}
                      </div>
                      {j.status === 'REWORK' && j.defectReason && (
                        <div className="mt-1 flex items-center gap-1 rounded bg-rose-100 dark:bg-rose-900/30 px-2 py-1 text-xs text-rose-700 dark:text-rose-300">
                          <NavIcon name="alert" className="h-3.5 w-3.5 shrink-0" /> {j.defectReason}
                        </div>
                      )}
                      {j.resultPhotoUrl && (
                        <a
                          href={`${SERVER_ORIGIN}${j.resultPhotoUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 block"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`${SERVER_ORIGIN}${j.resultPhotoUrl}`}
                            alt="результат"
                            className="h-16 w-full rounded-lg object-cover"
                          />
                        </a>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {NEXT[j.status] && (
                          <Button
                            size="sm"
                            onClick={() => setStatus(j.id, NEXT[j.status])}
                          >
                            →{' '}
                            {STAGES.find((s) => s.key === NEXT[j.status])?.label}
                          </Button>
                        )}
                        {/* Пауза / продолжить */}
                        {j.status !== 'PAUSED' &&
                          j.status !== 'COMPLETED' &&
                          j.status !== 'REWORK' &&
                          j.status !== 'CANCELLED' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setStatus(j.id, 'PAUSED')}
                            >
                              <NavIcon name="pause" className="h-4 w-4" />Пауза
                            </Button>
                          )}
                        {j.status === 'PAUSED' && (
                          <Button
                            variant="sky"
                            size="sm"
                            onClick={() => setStatus(j.id, 'PRINTING')}
                          >
                            <NavIcon name="play" className="h-4 w-4" />Продолжить
                          </Button>
                        )}
                        {j.status === 'REWORK' && (
                          <Button
                            variant="amber"
                            size="sm"
                            onClick={() => setStatus(j.id, 'PENDING')}
                          >
                            Вернуть в работу
                          </Button>
                        )}
                        {/* Фото результата */}
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700">
                          <NavIcon name="camera" className="h-3.5 w-3.5" />Фото
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadPhoto(j.id, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {j.status !== 'REWORK' &&
                          j.status !== 'CANCELLED' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-900/20"
                              onClick={() => sendRework(j.id)}
                            >
                              Брак
                            </Button>
                          )}
                        {canManage && (
                          <button
                            onClick={() => remove(j.id)}
                            className="rounded-lg px-2 py-1 text-xs text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
                          >
                            Удалить
                          </button>
                        )}
                      </div>
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
