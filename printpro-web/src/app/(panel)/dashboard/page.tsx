'use client';

import { useEffect, useState, ReactNode } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import NavIcon from '@/lib/NavIcons';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

const ORDER_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ACCEPTED:         { label: 'Принят',         color: 'bg-slate-400' },
  AWAITING_DESIGN:  { label: 'Ждёт макет',     color: 'bg-slate-500' },
  IN_DESIGN:        { label: 'Дизайн',          color: 'bg-slate-600' },
  DESIGN_APPROVAL:  { label: 'Согласование',    color: 'bg-indigo-400' },
  DESIGN_APPROVED:  { label: 'Согл. готово',    color: 'bg-indigo-500' },
  IN_PROGRESS:      { label: 'В производстве',  color: 'bg-indigo-700' },
  READY:            { label: 'Готов',           color: 'bg-emerald-600' },
  DELIVERED:        { label: 'Выдан',           color: 'bg-slate-300' },
  REWORK:           { label: 'Переделка',       color: 'bg-amber-500' },
  CANCELLED:        { label: 'Отменён',         color: 'bg-rose-400' },
};

function Trend({ now, prev }: { now: number; prev: number }) {
  if (!prev) return null;
  const diff = ((now - prev) / prev) * 100;
  if (Math.abs(diff) < 1) return <span className="text-xs text-slate-400">≈ без изменений</span>;
  const up = diff > 0;
  return (
    <span className={`text-xs font-medium ${up ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      {up ? '+' : '−'}{Math.abs(diff).toFixed(0)}% к вчера
    </span>
  );
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const cid = DEFAULT_COMPANY_ID;

  const [orders, setOrders] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [low, setLow] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [today, setToday] = useState<any>(null);
  const [yesterday, setYesterday] = useState<any>(null);
  const [daily, setDaily] = useState<any[]>([]);

  useEffect(() => {
    api.get(`/orders?companyId=${cid}&pageSize=200`).then((r) => setOrders(r.items ?? [])).catch(() => {});
    api.get(`/orders/debts?companyId=${cid}`).then(setDebts).catch(() => {});
    api.get(`/stock/low?companyId=${cid}`).then(setLow).catch(() => {});
    api.get(`/tasks?companyId=${cid}`).then(setTasks).catch(() => {});
    api.get(`/complaints?companyId=${cid}`).then(setComplaints).catch(() => {});

    if (can('reports.view')) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const yestStart = new Date(todayStart); yestStart.setDate(yestStart.getDate() - 1);
      const yestEnd = new Date(todayStart);

      api.get(`/reports/summary?companyId=${cid}&from=${todayStart.toISOString()}&to=${new Date().toISOString()}`)
        .then(setToday).catch(() => {});
      api.get(`/reports/summary?companyId=${cid}&from=${yestStart.toISOString()}&to=${yestEnd.toISOString()}`)
        .then(setYesterday).catch(() => {});
      api.get(`/reports/daily?companyId=${cid}&days=14`).then(setDaily).catch(() => {});
    }
  }, [cid]);

  const maxDaily = Math.max(1, ...daily.map((d) => d.amount));
  const totalDebt = debts.reduce((s, d) => s + (d.debt ?? 0), 0);
  const openTasks = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
  const openComplaints = complaints.filter((c) => c.status === 'OPEN' || c.status === 'IN_REVIEW');

  const inWork  = orders.filter((o) => o.status === 'IN_PROGRESS');
  const ready   = orders.filter((o) => o.status === 'READY');
  const active  = orders.filter((o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED');

  const soon = orders.filter((o) => {
    if (!o.deadline || o.status === 'DELIVERED' || o.status === 'CANCELLED') return false;
    const d = new Date(o.deadline).getTime() - Date.now();
    return d < 2 * 24 * 3600 * 1000;
  });

  const statusCounts: Record<string, number> = {};
  active.forEach((o) => { statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1; });
  const totalActive = active.length || 1;

  const ALL_ACTIONS: { href: string; label: string; icon: string; perm: string | null; primary?: boolean }[] = [
    { href: '/orders/new', label: 'Новый заказ',  icon: 'plus',       perm: 'orders.manage', primary: true },
    { href: '/pos',        label: 'Касса',         icon: 'pos',        perm: 'cash.operate' },
    { href: '/production', label: 'Производство',  icon: 'production', perm: 'production.view' },
    { href: '/warehouse',  label: 'Склад',         icon: 'warehouse',  perm: 'stock.view' },
    { href: '/clients',    label: 'Клиенты',       icon: 'clients',    perm: 'clients.view' },
    { href: '/reports',    label: 'Отчёты',        icon: 'reports',    perm: 'reports.view' },
  ];
  const actions = ALL_ACTIONS.filter((a) => !a.perm || can(a.perm));

  return (
    <div>
      {/* Шапка */}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-5 dark:border-slate-700/60">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Панель управления</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {user?.fullName}
          </h1>
        </div>
        {openComplaints.length > 0 && (
          <Link
            href="/complaints"
            className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
          >
            <NavIcon name="alert" className="h-4 w-4" />
            Рекламации в работе: {openComplaints.length}
          </Link>
        )}
      </div>

      {/* Быстрые действия */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className={
              a.primary
                ? 'group flex items-center gap-3 rounded-lg bg-slate-900 px-4 py-3.5 text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white'
                : 'group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800/60'
            }
          >
            <span
              className={
                a.primary
                  ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/15'
                  : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }
            >
              <NavIcon name={a.icon} className="h-[18px] w-[18px]" />
            </span>
            <span className="text-sm font-medium">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* KPI */}
      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 lg:grid-cols-4 dark:border-slate-700/60 dark:bg-slate-700/60">
        <Kpi icon="cash" label="Выручка сегодня" value={today ? money(today.collected) : '—'} sub={<Trend now={today?.collected ?? 0} prev={yesterday?.collected ?? 0} />} />
        <Kpi icon="production" label="В производстве" value={String(inWork.length)} sub="заказов в работе" />
        <Kpi icon="check" label="Готово к выдаче" value={String(ready.length)} accent={ready.length > 0} sub={ready.length > 0 ? 'можно выдавать' : 'нет готовых'} />
        <Kpi icon="alert" label="Долги" value={money(totalDebt)} sub={`${debts.length} заказов`} />
      </div>

      {/* Разбивка по статусам */}
      {active.length > 0 && (
        <Section title="Заказы по статусам" right={<span className="text-sm text-slate-400">активных: {active.length}</span>} className="mb-6">
          <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {Object.entries(statusCounts).map(([status, cnt]) => {
              const pct = (cnt / totalActive) * 100;
              const col = ORDER_STATUS_LABELS[status]?.color ?? 'bg-slate-300';
              return (
                <div key={status} className={col} style={{ width: `${pct}%` }} title={`${ORDER_STATUS_LABELS[status]?.label ?? status}: ${cnt}`} />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {Object.entries(statusCounts).map(([status, cnt]) => {
              const { label, color } = ORDER_STATUS_LABELS[status] ?? { label: status, color: 'bg-slate-300' };
              return (
                <span key={status} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-sm ${color}`} />
                  {label} · <span className="font-semibold tabular-nums">{cnt}</span>
                </span>
              );
            })}
          </div>
        </Section>
      )}

      {/* График выручки */}
      {can('reports.view') && daily.length > 0 && (
        <Section title="Выручка за 14 дней" className="mb-6">
          <div className="flex h-40 items-end gap-1.5">
            {daily.map((d, i) => {
              const isToday = i === daily.length - 1;
              const h = Math.max(2, (d.amount / maxDaily) * 100);
              return (
                <div key={d.date} className="group flex h-full flex-1 flex-col items-center justify-end">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={`w-full rounded-sm transition group-hover:opacity-80 ${isToday ? 'bg-indigo-700 dark:bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                      style={{ height: `${h}%` }}
                      title={`${d.date}: ${money(d.amount)}`}
                    />
                  </div>
                  <span className="mt-1.5 text-[9px] tabular-nums text-slate-400">{d.date.slice(8, 10)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300 dark:bg-slate-600" /> по дням</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-700 dark:bg-indigo-500" /> сегодня</span>
          </div>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {ready.length > 0 && (
          <Panel title="Готово — нужно выдать" icon="check">
            {ready.slice(0, 5).map((o) => (
              <Link key={o.id} href="/orders" className="block">
                <Row>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    №{o.orderNumber}
                    {o.client && <span className="ml-1.5 font-normal text-slate-500"> · {o.client.fullName ?? o.client.phone}</span>}
                  </span>
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">Готов</span>
                </Row>
              </Link>
            ))}
          </Panel>
        )}

        <Panel title="Дедлайн скоро" icon="clock">
          {soon.length === 0 ? (
            <Empty text="Срочных заказов нет" />
          ) : (
            soon.slice(0, 5).map((o) => (
              <Row key={o.id}>
                <span className="text-slate-700 dark:text-slate-200">№{o.orderNumber} · {o.client?.fullName ?? o.client?.phone ?? '—'}</span>
                <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {new Date(o.deadline).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                </span>
              </Row>
            ))
          )}
        </Panel>

        <Panel title="Должники" icon="cash">
          {debts.length === 0 ? (
            <Empty text="Долгов нет" />
          ) : (
            debts.slice(0, 5).map((d) => (
              <Row key={d.orderId}>
                <span className="text-slate-700 dark:text-slate-200">№{d.orderNumber} · {d.client}</span>
                <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">{money(d.debt)}</span>
              </Row>
            ))
          )}
        </Panel>

        <Panel title="Заканчивается на складе" icon="warehouse">
          {low.length === 0 ? (
            <Empty text="Запасы в норме" />
          ) : (
            low.map((l, i) => (
              <Row key={i}>
                <span className="text-slate-700 dark:text-slate-200">{l.productName}</span>
                <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {l.quantity} {l.unit}
                  <span className="ml-1 text-xs font-normal text-slate-400">(≤{l.minStock})</span>
                </span>
              </Row>
            ))
          )}
        </Panel>

        {openTasks.length > 0 && (
          <Panel title="Открытые задачи" icon="tasks">
            {openTasks.slice(0, 5).map((t) => (
              <Row key={t.id}>
                <span className="text-slate-700 dark:text-slate-200">{t.title}</span>
                <span className="text-xs text-slate-400">{t.assignedUser?.fullName ?? '—'}</span>
              </Row>
            ))}
          </Panel>
        )}

        {openComplaints.length > 0 && (
          <Panel title="Рекламации в работе" icon="complaints">
            {openComplaints.slice(0, 5).map((c) => (
              <Link key={c.id} href="/complaints" className="block">
                <Row>
                  <span className="text-slate-700 dark:text-slate-200">{c.title}</span>
                  <span className="rounded border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {c.status === 'OPEN' ? 'Открыта' : 'В работе'}
                  </span>
                </Row>
              </Link>
            ))}
          </Panel>
        )}
      </div>
    </div>
  );
}

/* ===== Строгие компоненты ===== */

function Kpi({
  icon, label, value, sub, accent,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="relative bg-white p-5 dark:bg-slate-900">
      {accent && <span className="absolute inset-y-0 left-0 w-0.5 bg-indigo-700 dark:bg-indigo-500" />}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</span>
        <NavIcon name={icon} className="h-4 w-4 text-slate-300 dark:text-slate-600" />
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Section({
  title, right, children, className = '',
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-900 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-300">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-900">
      <div className="mb-3 flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-700/60">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          <NavIcon name={icon} className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm last:border-0 dark:border-slate-700/60">
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-6 text-center text-sm text-slate-400">{text}</div>;
}
