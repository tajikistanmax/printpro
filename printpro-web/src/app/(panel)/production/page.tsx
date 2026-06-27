'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { API_BASE, DEFAULT_COMPANY_ID, SERVER_ORIGIN } from '@/lib/config';
import { useAuth } from '@/lib/auth';

// Этапы производства по порядку
const STAGES: { key: string; label: string; color: string }[] = [
  { key: 'PENDING', label: 'Ожидает', color: 'border-slate-300 bg-slate-50' },
  { key: 'PRINTING', label: 'Печать', color: 'border-sky-300 bg-sky-50' },
  { key: 'CUTTING', label: 'Резка', color: 'border-amber-300 bg-amber-50' },
  { key: 'BINDING', label: 'Брошюровка', color: 'border-violet-300 bg-violet-50' },
  { key: 'PACKAGING', label: 'Упаковка', color: 'border-indigo-300 bg-indigo-50' },
  { key: 'PAUSED', label: 'На паузе', color: 'border-slate-300 bg-slate-100' },
  { key: 'COMPLETED', label: 'Готово', color: 'border-emerald-300 bg-emerald-50' },
  { key: 'REWORK', label: 'Брак / переделка', color: 'border-rose-300 bg-rose-50' },
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

  const [jobs, setJobs] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [orderId, setOrderId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [printer, setPrinter] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [equipment, setEquipment] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  function load() {
    api.get(`/production?companyId=${cid}`).then(setJobs).catch(() => {});
  }
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
      if (can('users.view')) {
        api.get(`/users?companyId=${cid}`).then(setUsers).catch(() => {});
      }
    }
  }, [cid]);

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
    await api.patch(`/production/${id}/status`, { status });
    load();
  }

  async function sendRework(id: string) {
    const reason = prompt('Причина брака / переделки:');
    if (reason === null) return;
    await api.patch(`/production/${id}/status`, {
      status: 'REWORK',
      defectReason: reason || undefined,
    });
    load();
  }

  async function uploadPhoto(id: string, file: File) {
    const fd = new FormData();
    fd.append('file', file);
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('pp_token') : null;
    await fetch(`${API_BASE}/production/${id}/photo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Удалить задание?')) return;
    await api.del(`/production/${id}`);
    load();
  }

  const byStage = (key: string) => jobs.filter((j) => j.status === key);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Производство</h1>

      {canManage && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-700">
            Запустить заказ в производство
          </h2>
          <form onSubmit={createJob} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-sm text-slate-500">Заказ</label>
              <select
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
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
            <div className="min-w-[180px]">
              <label className="mb-1 block text-sm text-slate-500">Исполнитель</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">— не назначен —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[170px]">
              <label className="mb-1 block text-sm text-slate-500">Оборудование</label>
              {equipment.length > 0 ? (
                <select
                  value={equipmentId}
                  onChange={(e) => setEquipmentId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="">— не выбрано —</option>
                  {equipment.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={printer}
                  onChange={(e) => setPrinter(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="напр. Roland"
                />
              )}
            </div>
            <button className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700">
              В работу
            </button>
            {msg && <span className="text-sm text-slate-600">{msg}</span>}
          </form>
        </div>
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
                <span className="font-semibold text-slate-700">{stage.label}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                  {list.length}
                </span>
              </div>
              <div className="space-y-2">
                {list.length === 0 ? (
                  <p className="px-1 py-3 text-sm text-slate-400">Пусто</p>
                ) : (
                  list.map((j) => (
                    <div
                      key={j.id}
                      className="rounded-xl bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800">
                          №{j.order?.orderNumber}
                        </span>
                        {j.priority > 0 && (
                          <span className="rounded bg-rose-100 px-1.5 text-xs text-rose-600">
                            приоритет
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-sm text-slate-500">
                        {j.order?.client?.fullName ??
                          j.order?.client?.phone ??
                          'без клиента'}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                        {j.assignedUser && <span>👤 {j.assignedUser.fullName}</span>}
                        {(j.equipment?.name || j.printer) && (
                          <span>🖨 {j.equipment?.name ?? j.printer}</span>
                        )}
                      </div>
                      {j.status === 'REWORK' && j.defectReason && (
                        <div className="mt-1 rounded bg-rose-100 px-2 py-1 text-xs text-rose-700">
                          ⚠ {j.defectReason}
                        </div>
                      )}
                      {j.resultPhotoUrl && (
                        <a
                          href={`${SERVER_ORIGIN}${j.resultPhotoUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 block"
                        >
                          <img
                            src={`${SERVER_ORIGIN}${j.resultPhotoUrl}`}
                            alt="результат"
                            className="h-16 w-full rounded-lg object-cover"
                          />
                        </a>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {NEXT[j.status] && (
                          <button
                            onClick={() => setStatus(j.id, NEXT[j.status])}
                            className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                          >
                            →{' '}
                            {STAGES.find((s) => s.key === NEXT[j.status])?.label}
                          </button>
                        )}
                        {/* Пауза / продолжить */}
                        {j.status !== 'PAUSED' &&
                          j.status !== 'COMPLETED' &&
                          j.status !== 'REWORK' &&
                          j.status !== 'CANCELLED' && (
                            <button
                              onClick={() => setStatus(j.id, 'PAUSED')}
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
                            >
                              ⏸ Пауза
                            </button>
                          )}
                        {j.status === 'PAUSED' && (
                          <button
                            onClick={() => setStatus(j.id, 'PRINTING')}
                            className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700"
                          >
                            ▶ Продолжить
                          </button>
                        )}
                        {j.status === 'REWORK' && (
                          <button
                            onClick={() => setStatus(j.id, 'PENDING')}
                            className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600"
                          >
                            Вернуть в работу
                          </button>
                        )}
                        {/* Фото результата */}
                        <label className="cursor-pointer rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">
                          📷 Фото
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
                            <button
                              onClick={() => sendRework(j.id)}
                              className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50"
                            >
                              Брак
                            </button>
                          )}
                        {canManage && (
                          <button
                            onClick={() => remove(j.id)}
                            className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-rose-600"
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
