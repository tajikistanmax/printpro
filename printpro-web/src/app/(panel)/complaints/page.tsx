'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import {
  PageHeader,
  StatGrid,
  StatCard,
  Tabs,
  TabItem,
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
import NavIcon from '@/lib/NavIcons';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN:      { label: 'Открыта',          tone: 'amber' },
  IN_REVIEW: { label: 'На рассмотрении',  tone: 'sky' },
  RESOLVED:  { label: 'Решена',           tone: 'emerald' },
  REJECTED:  { label: 'Отклонена',        tone: 'rose' },
  CLOSED:    { label: 'Закрыта',          tone: 'slate' },
};

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'emerald' | 'sky' | 'amber';

const NEXT_ACTIONS: Record<string, { to: string; label: string; variant: BtnVariant }[]> = {
  OPEN:      [{ to: 'IN_REVIEW', label: 'Взять в работу', variant: 'sky' }],
  IN_REVIEW: [
    { to: 'RESOLVED', label: 'Решена',    variant: 'emerald' },
    { to: 'REJECTED', label: 'Отклонить', variant: 'danger' },
  ],
  RESOLVED:  [{ to: 'CLOSED', label: 'Закрыть', variant: 'ghost' }],
  REJECTED:  [{ to: 'CLOSED', label: 'Закрыть', variant: 'ghost' }],
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

  const tabs: TabItem[] = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    ...(t.key === '' && list.length > 0 ? { count: list.length } : {}),
  }));

  return (
    <div>
      <PageHeader
        icon="complaints"
        iconTone="rose"
        title="Рекламации"
        subtitle={
          <span className="inline-flex items-center gap-2">
            Жалобы и претензии клиентов
            {openCount > 0 && <Badge tone="rose">{openCount} активных</Badge>}
          </span>
        }
        actions={
          canManage && (
            <Button
              variant={showForm ? 'ghost' : 'primary'}
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? 'Отмена' : '+ Новая рекламация'}
            </Button>
          )
        }
      />

      {/* Сводка */}
      <StatGrid cols={4}>
        <StatCard icon="complaints" tone="rose" label="Активных" value={openCount} highlight />
        <StatCard icon="complaints" tone="amber" label="Открытые" value={counts['OPEN'] ?? 0} />
        <StatCard icon="reports" tone="sky" label="В работе" value={counts['IN_REVIEW'] ?? 0} />
        <StatCard icon="orders" tone="emerald" label="Решённые" value={counts['RESOLVED'] ?? 0} />
      </StatGrid>

      {/* Форма добавления */}
      {showForm && (
        <Card className="mb-6">
          <SectionTitle>Новая рекламация</SectionTitle>
          <form onSubmit={create} className="space-y-3">
            <Input
              value={title} onChange={(e) => setTitle(e.target.value)} required
              placeholder="Суть претензии (напр. Брак печати, заказ №…) *"
            />
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Подробности, что не так, что клиент ожидает"
              rows={3}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm transition focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Клиент (необязательно)">
                <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">— не указан —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName ?? 'Без имени'} · {c.phone}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Заказ (необязательно)">
                <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                  <option value="">— не указан —</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      №{o.orderNumber} · {o.client?.fullName ?? o.client?.phone ?? '—'}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit">
                Зарегистрировать
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Отмена
              </Button>
              {formMsg && <span className="text-sm text-slate-600">{formMsg}</span>}
            </div>
          </form>
        </Card>
      )}

      {/* Фильтр по статусу */}
      <Tabs tabs={tabs} active={filter} onChange={setFilter} />

      {/* Список рекламаций */}
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon="complaints"
            title={filter ? 'Рекламаций с этим статусом нет.' : 'Рекламаций нет. Это хорошо! 👍'}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((c) => {
            const st = STATUS[c.status] ?? STATUS.OPEN;
            const nextActions = NEXT_ACTIONS[c.status] ?? [];
            return (
              <Card key={c.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {/* Заголовок + статус */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{c.title}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>

                    {/* Описание */}
                    {c.description && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{c.description}</p>
                    )}

                    {/* Мета: клиент / заказ / дата */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                      {c.client && (
                        <span className="inline-flex items-center gap-1">
                          <NavIcon name="user" className="h-3.5 w-3.5" />{c.client.fullName ?? 'Без имени'} · {c.client.phone}
                        </span>
                      )}
                      {c.order && (
                        <span className="inline-flex items-center gap-1"><NavIcon name="clipboard" className="h-3.5 w-3.5" />Заказ №{c.order.orderNumber}</span>
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
                      <Button key={a.to} variant={a.variant} size="sm" onClick={() => updateStatus(c.id, a.to)}>
                        {a.label}
                      </Button>
                    ))}
                    <button onClick={() => remove(c.id)}
                      className="ml-auto rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:text-rose-600 dark:hover:text-rose-400">
                      Удалить
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
