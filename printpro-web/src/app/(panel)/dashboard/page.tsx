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
  AWAITING_DESIGN:  { label: 'Ждёт макет',     color: 'bg-cyan-500' },
  IN_DESIGN:        { label: 'Дизайн',          color: 'bg-sky-500' },
  DESIGN_APPROVAL:  { label: 'Согласование',    color: 'bg-violet-400' },
  DESIGN_APPROVED:  { label: 'Согл. готово',    color: 'bg-violet-600' },
  IN_PROGRESS:      { label: 'В производстве',  color: 'bg-indigo-600' },
  READY:            { label: 'Готов',           color: 'bg-emerald-500' },
  DELIVERED:        { label: 'Выдан',           color: 'bg-slate-300' },
  REWORK:           { label: 'Переделка',       color: 'bg-amber-500' },
  CANCELLED:        { label: 'Отменён',         color: 'bg-rose-400' },
};

// Яркий тренд на цветном фоне KPI-карточки
function TrendLight({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <>нет данных за вчера</>;
  const diff = ((now - prev) / prev) * 100;
  if (Math.abs(diff) < 1) return <>≈ как вчера</>;
  const up = diff > 0;
  return (
    <span className="font-medium text-white">
      {up ? '▲' : '▼'} {Math.abs(diff).toFixed(0)}% к вчера
    </span>
  );
}

const ACTION_TONE: Record<string, string> = {
  plus: 'from-indigo-500 to-violet-600',
  pos: 'from-emerald-500 to-teal-600',
  production: 'from-sky-500 to-blue-600',
  warehouse: 'from-amber-500 to-orange-600',
  clients: 'from-rose-500 to-pink-600',
  reports: 'from-fuchsia-500 to-purple-600',
};

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

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

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
      {/* Шапка с брендовым акцентом */}
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-white shadow-lg shadow-violet-500/30">
            <NavIcon name="home" className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-400">Панель управления</div>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {greeting}{firstName && `, ${firstName}`}
            </h1>
          </div>
        </div>
        {openComplaints.length > 0 && (
          <Link
            href="/complaints"
            className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
          >
            <NavIcon name="alert" className="h-4 w-4" />
            Рекламации в работе: {openComplaints.length}
          </Link>
        )}
      </div>

      {/* Быстрые действия — цветные */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white px-4 py-3.5 text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${ACTION_TONE[a.icon] ?? 'from-slate-500 to-slate-600'}`}
            >
              <NavIcon name={a.icon} className="h-[18px] w-[18px]" />
            </span>
            <span className="text-sm font-semibold">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* KPI — яркие градиентные карточки */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon="cash"
          label="Выручка сегодня"
          value={today ? money(today.collected) : '—'}
          grad="from-indigo-500 to-violet-600 shadow-violet-500/25"
          sub={today ? <TrendLight now={today.collected ?? 0} prev={yesterday?.collected ?? 0} /> : 'нет данных'}
        />
        <KpiCard
          icon="production"
          label="В производстве"
          value={String(inWork.length)}
          grad="from-sky-500 to-blue-600 shadow-blue-500/25"
          sub="заказов в работе"
        />
        <KpiCard
          icon="check"
          label="Готово к выдаче"
          value={String(ready.length)}
          grad="from-emerald-500 to-teal-600 shadow-emerald-500/25"
          sub={ready.length > 0 ? 'можно выдавать' : 'нет готовых'}
        />
        <KpiCard
          icon="alert"
          label="Долги"
          value={money(totalDebt)}
          grad="from-rose-500 to-pink-600 shadow-rose-500/25"
          sub={`${debts.length} заказов`}
        />
      </div>

      {/* Разбивка по статусам */}
      {active.length > 0 && (
        <Section title="Заказы по статусам" right={<span className="text-sm text-slate-400">активных: {active.length}</span>} className="mb-6">
          <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
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
                  <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
                  {label} · <span className="font-semibold tabular-nums">{cnt}</span>
                </span>
              );
            })}
          </div>
        </Section>
      )}

      {/* График выручки — градиентные столбики */}
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
                      className={`w-full rounded-md bg-gradient-to-t transition group-hover:opacity-80 ${
                        isToday
                          ? 'from-pink-500 to-fuchsia-400'
                          : 'from-indigo-500 to-violet-400 dark:from-indigo-600 dark:to-violet-500'
                      }`}
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
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-indigo-500 to-violet-400" /> по дням</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-pink-500 to-fuchsia-400" /> сегодня</span>
          </div>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {ready.length > 0 && (
          <Panel title="Готово — нужно выдать" icon="check" tone="from-emerald-500 to-teal-600">
            {ready.slice(0, 5).map((o) => (
              <Link key={o.id} href="/orders" className="block">
                <Row>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    №{o.orderNumber}
                    {o.client && <span className="ml-1.5 font-normal text-slate-500"> · {o.client.fullName ?? o.client.phone}</span>}
                  </span>
                  <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">Готов</span>
                </Row>
              </Link>
            ))}
          </Panel>
        )}

        <Panel title="Дедлайн скоро" icon="clock" tone="from-amber-500 to-orange-600">
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

        <Panel title="Должники" icon="cash" tone="from-rose-500 to-pink-600">
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

        <Panel title="Заканчивается на складе" icon="warehouse" tone="from-amber-500 to-orange-600">
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
          <Panel title="Открытые задачи" icon="tasks" tone="from-sky-500 to-blue-600">
            {openTasks.slice(0, 5).map((t) => (
              <Row key={t.id}>
                <span className="text-slate-700 dark:text-slate-200">{t.title}</span>
                <span className="text-xs text-slate-400">{t.assignedUser?.fullName ?? '—'}</span>
              </Row>
            ))}
          </Panel>
        )}

        {openComplaints.length > 0 && (
          <Panel title="Рекламации в работе" icon="complaints" tone="from-violet-500 to-purple-600">
            {openComplaints.slice(0, 5).map((c) => (
              <Link key={c.id} href="/complaints" className="block">
                <Row>
                  <span className="text-slate-700 dark:text-slate-200">{c.title}</span>
                  <span className="rounded-md border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
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

/* ===== Компоненты ===== */

function KpiCard({
  icon, label, value, sub, grad,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: ReactNode;
  grad: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-lg ${grad}`}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-8 -left-4 h-20 w-20 rounded-full bg-black/5" />
      <div className="relative flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/85">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
          <NavIcon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className="relative mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="relative mt-1 text-xs text-white/85">{sub}</div>}
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
    <div className={`rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-900 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-300">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Panel({ title, icon, tone, children }: { title: string; icon: string; tone: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-900">
      <div className="mb-3 flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-700/60">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${tone}`}>
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
