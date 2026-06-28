'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

const ORDER_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ACCEPTED:         { label: 'Принят',         color: 'bg-slate-400' },
  AWAITING_DESIGN:  { label: 'Ждёт макет',     color: 'bg-purple-400' },
  IN_DESIGN:        { label: 'Дизайн',          color: 'bg-violet-500' },
  DESIGN_APPROVAL:  { label: 'Согласование',    color: 'bg-indigo-400' },
  DESIGN_APPROVED:  { label: 'Согл. готово',    color: 'bg-blue-400' },
  IN_PROGRESS:      { label: 'В производстве',  color: 'bg-sky-500' },
  READY:            { label: 'Готов',           color: 'bg-emerald-500' },
  DELIVERED:        { label: 'Выдан',           color: 'bg-green-400' },
  REWORK:           { label: 'Переделка',       color: 'bg-amber-500' },
  CANCELLED:        { label: 'Отменён',         color: 'bg-rose-400' },
};

function Trend({ now, prev }: { now: number; prev: number }) {
  if (!prev) return null;
  const diff = ((now - prev) / prev) * 100;
  if (Math.abs(diff) < 1) return <span className="text-xs text-slate-400">≈ без изм.</span>;
  const up = diff > 0;
  return (
    <span className={`text-xs font-medium ${up ? 'text-emerald-500' : 'text-rose-500'}`}>
      {up ? '↑' : '↓'} {Math.abs(diff).toFixed(0)}% vs вчера
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

  // Разбивка заказов по статусам (только активные)
  const statusCounts: Record<string, number> = {};
  active.forEach((o) => { statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1; });
  const totalActive = active.length || 1;

  const actions = [
    { href: '/orders/new', label: 'Новый заказ',    icon: '➕', color: 'from-indigo-500 to-indigo-600', perm: 'orders.manage' },
    { href: '/pos',        label: 'Касса',          icon: '💳', color: 'from-emerald-500 to-emerald-600', perm: 'cash.operate' },
    { href: '/production', label: 'Производство',   icon: '🏭', color: 'from-sky-500 to-sky-600', perm: 'production.view' },
    { href: '/warehouse',  label: 'Склад',          icon: '📦', color: 'from-amber-500 to-amber-600', perm: 'stock.view' },
    { href: '/clients',    label: 'Клиенты',        icon: '🧑', color: 'from-violet-500 to-violet-600', perm: 'clients.view' },
    { href: '/reports',    label: 'Отчёты',         icon: '📊', color: 'from-rose-500 to-rose-600', perm: 'reports.view' },
  ].filter((a) => !a.perm || can(a.perm));

  return (
    <div>
      {/* Приветствие */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            Здравствуйте, {user?.fullName} 👋
          </h1>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">Обзор работы типографии</p>
        </div>
        {openComplaints.length > 0 && (
          <Link href="/complaints"
            className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-300">
            ⚠ Рекламации: {openComplaints.length}
          </Link>
        )}
      </div>

      {/* Быстрые действия */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        {actions.map((a) => (
          <Link key={a.href} href={a.href}
            className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-br ${a.color} px-3 py-4 text-center text-white shadow-sm transition hover:opacity-90 hover:shadow-md`}>
            <span className="text-2xl">{a.icon}</span>
            <span className="text-xs font-semibold">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* KPI карточки */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon="💰"
          label="Выручка сегодня"
          value={today ? money(today.collected) : '—'}
          sub={<Trend now={today?.collected ?? 0} prev={yesterday?.collected ?? 0} />}
          tint="emerald"
        />
        <KpiCard
          icon="🏭"
          label="В производстве"
          value={inWork.length}
          sub={<span className="text-xs text-slate-400">заказов</span>}
          tint="sky"
        />
        <KpiCard
          icon="✅"
          label="Готово к выдаче"
          value={ready.length}
          sub={ready.length > 0
            ? <span className="text-xs font-semibold text-emerald-500">Можно выдавать!</span>
            : <span className="text-xs text-slate-400">нет готовых</span>
          }
          tint="indigo"
          highlight={ready.length > 0}
        />
        <KpiCard
          icon="⚠️"
          label="Долги"
          value={money(totalDebt)}
          sub={<span className="text-xs text-slate-400">{debts.length} заказов</span>}
          tint="rose"
        />
      </div>

      {/* Разбивка по статусам */}
      {active.length > 0 && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-700 dark:text-slate-200">
              Заказы по статусам
            </h2>
            <span className="text-sm text-slate-400">активных: {active.length}</span>
          </div>
          {/* Полосовая диаграмма */}
          <div className="mb-3 flex h-3 overflow-hidden rounded-full">
            {Object.entries(statusCounts).map(([status, cnt]) => {
              const pct = (cnt / totalActive) * 100;
              const col = ORDER_STATUS_LABELS[status]?.color ?? 'bg-slate-300';
              return (
                <div key={status} className={`${col} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${ORDER_STATUS_LABELS[status]?.label ?? status}: ${cnt}`} />
              );
            })}
          </div>
          {/* Легенда */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(statusCounts).map(([status, cnt]) => {
              const { label, color } = ORDER_STATUS_LABELS[status] ?? { label: status, color: 'bg-slate-300' };
              return (
                <span key={status} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
                  {label}: <span className="font-semibold">{cnt}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* График выручки */}
      {can('reports.view') && daily.length > 0 && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
          <h2 className="mb-4 font-semibold text-slate-700 dark:text-slate-200">Выручка за 14 дней</h2>
          <div className="flex h-36 items-end gap-1">
            {daily.map((d, i) => {
              const isToday = i === daily.length - 1;
              const h = Math.max(2, (d.amount / maxDaily) * 100);
              return (
                <div key={d.date} className="group flex h-full flex-1 flex-col items-center justify-end">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={`w-full rounded-t transition group-hover:opacity-80 ${isToday ? 'bg-emerald-500' : 'bg-indigo-400 dark:bg-indigo-500'}`}
                      style={{ height: `${h}%` }}
                      title={`${d.date}: ${money(d.amount)}`}
                    />
                  </div>
                  <span className="mt-1 text-[9px] text-slate-400 dark:text-slate-500">
                    {d.date.slice(8, 10)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-indigo-400 dark:bg-indigo-500"/>&nbsp;дни</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-emerald-500"/>&nbsp;сегодня</span>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Готовые к выдаче */}
        {ready.length > 0 && (
          <Panel title="✅ Готово — нужно выдать" accent="emerald">
            {ready.slice(0, 5).map((o) => (
              <Link key={o.id} href="/orders" className="block">
                <Row>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    №{o.orderNumber}
                    {o.client && <span className="ml-1.5 font-normal text-slate-500"> · {o.client.fullName ?? o.client.phone}</span>}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    Готов
                  </span>
                </Row>
              </Link>
            ))}
          </Panel>
        )}

        {/* Срочные заказы */}
        <Panel title="🔥 Дедлайн скоро">
          {soon.length === 0 ? (
            <Empty text="Срочных нет" />
          ) : (
            soon.slice(0, 5).map((o) => (
              <Row key={o.id}>
                <span className="text-slate-700 dark:text-slate-200">
                  №{o.orderNumber} · {o.client?.fullName ?? o.client?.phone ?? '—'}
                </span>
                <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {new Date(o.deadline).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                </span>
              </Row>
            ))
          )}
        </Panel>

        {/* Долги */}
        <Panel title="Должники">
          {debts.length === 0 ? (
            <Empty text="Долгов нет" />
          ) : (
            debts.slice(0, 5).map((d) => (
              <Row key={d.orderId}>
                <span className="text-slate-700 dark:text-slate-200">
                  №{d.orderNumber} · {d.client}
                </span>
                <span className="font-semibold text-rose-600 dark:text-rose-400">{money(d.debt)}</span>
              </Row>
            ))
          )}
        </Panel>

        {/* Склад */}
        <Panel title="📦 Заканчивается на складе">
          {low.length === 0 ? (
            <Empty text="Запасы в норме" />
          ) : (
            low.map((l, i) => (
              <Row key={i}>
                <span className="text-slate-700 dark:text-slate-200">{l.productName}</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {l.quantity} {l.unit}
                  <span className="ml-1 text-xs font-normal text-slate-400">(≤{l.minStock})</span>
                </span>
              </Row>
            ))
          )}
        </Panel>

        {/* Задачи */}
        {openTasks.length > 0 && (
          <Panel title="📋 Открытые задачи">
            {openTasks.slice(0, 5).map((t) => (
              <Row key={t.id}>
                <span className="text-slate-700 dark:text-slate-200">{t.title}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {t.assignedUser?.fullName ?? '—'}
                </span>
              </Row>
            ))}
          </Panel>
        )}

        {/* Рекламации */}
        {openComplaints.length > 0 && (
          <Panel title="⚠ Рекламации в работе" accent="rose">
            {openComplaints.slice(0, 5).map((c) => (
              <Link key={c.id} href="/complaints" className="block">
                <Row>
                  <span className="text-slate-700 dark:text-slate-200">{c.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    c.status === 'OPEN'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                  }`}>
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

function KpiCard({
  icon, label, value, sub, tint, highlight,
}: {
  icon: string;
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  tint: 'emerald' | 'sky' | 'indigo' | 'rose';
  highlight?: boolean;
}) {
  const tints: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    sky:     'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
    indigo:  'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
    rose:    'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  };
  return (
    <div className={`flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm transition hover:shadow-md dark:bg-slate-900 ${
      highlight ? 'ring-2 ring-emerald-400' : ''
    }`}>
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl ${tints[tint]}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="truncate text-xl font-bold text-slate-800 dark:text-slate-100">{value}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        {sub && <div className="mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function Panel({
  title, children, accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: 'emerald' | 'rose';
}) {
  const borders: Record<string, string> = {
    emerald: 'border-l-4 border-emerald-400',
    rose:    'border-l-4 border-rose-400',
  };
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900 ${accent ? borders[accent] : ''}`}>
      <h2 className="mb-3 font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-700">
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-5 text-center text-sm text-slate-400 dark:text-slate-500">
      <span className="text-2xl opacity-40">✓</span>
      {text}
    </div>
  );
}
