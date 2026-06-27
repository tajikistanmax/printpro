'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const cid = DEFAULT_COMPANY_ID;
  const [orders, setOrders] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [low, setLow] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [today, setToday] = useState<any>(null);
  const [daily, setDaily] = useState<any[]>([]);

  useEffect(() => {
    api.get(`/orders?companyId=${cid}`).then(setOrders).catch(() => {});
    api.get(`/orders/debts?companyId=${cid}`).then(setDebts).catch(() => {});
    api.get(`/stock/low?companyId=${cid}`).then(setLow).catch(() => {});
    api.get(`/tasks?companyId=${cid}`).then(setTasks).catch(() => {});
    if (can('reports.view')) {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      api
        .get(
          `/reports/summary?companyId=${cid}&from=${from.toISOString()}&to=${new Date().toISOString()}`,
        )
        .then(setToday)
        .catch(() => {});
      api
        .get(`/reports/daily?companyId=${cid}&days=14`)
        .then(setDaily)
        .catch(() => {});
    }
  }, [cid]);

  const maxDaily = Math.max(1, ...daily.map((d) => d.amount));

  const totalDebt = debts.reduce((s, d) => s + (d.debt ?? 0), 0);
  const openTasks = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
  const inWork = orders.filter((o) => o.status === 'IN_PROGRESS');
  const ready = orders.filter((o) => o.status === 'READY');

  // Срочные: дедлайн в ближайшие 2 дня и ещё не выдан
  const soon = orders.filter((o) => {
    if (!o.deadline || o.status === 'DELIVERED' || o.status === 'CANCELLED')
      return false;
    const d = new Date(o.deadline).getTime() - Date.now();
    return d < 2 * 24 * 3600 * 1000;
  });

  const cards = [
    {
      label: 'Выручка сегодня',
      value: today ? money(today.collected) : '—',
      color: 'bg-emerald-500',
    },
    { label: 'Заказов в работе', value: inWork.length, color: 'bg-sky-500' },
    { label: 'Готово к выдаче', value: ready.length, color: 'bg-indigo-500' },
    { label: 'Долги (сумма)', value: money(totalDebt), color: 'bg-rose-500' },
  ];

  const actions = [
    { href: '/orders/new', label: 'Новый заказ', icon: '➕', perm: 'orders.manage' },
    { href: '/cash', label: 'Касса', icon: '💰', perm: 'cash.view' },
    { href: '/production', label: 'Производство', icon: '🏭', perm: 'production.view' },
    { href: '/warehouse', label: 'Склад', icon: '📦', perm: 'stock.view' },
    { href: '/clients', label: 'Клиенты', icon: '🧑', perm: 'clients.view' },
    { href: '/reports', label: 'Отчёты', icon: '📊', perm: 'reports.view' },
  ].filter((a) => !a.perm || can(a.perm));

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-800">
        Здравствуйте, {user?.fullName}
      </h1>
      <p className="mb-6 text-slate-500">Обзор работы типографии</p>

      {/* Быстрые кнопки */}
      <div className="mb-6 flex flex-wrap gap-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-indigo-50 hover:text-indigo-700"
          >
            <span>{a.icon}</span>
            {a.label}
          </Link>
        ))}
      </div>

      {/* Карточки-показатели */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl bg-white p-5 shadow-sm">
            <div className={`mb-3 h-2 w-10 rounded-full ${c.color}`} />
            <div className="text-2xl font-bold text-slate-800">{c.value}</div>
            <div className="text-sm text-slate-500">{c.label}</div>
          </div>
        ))}
      </div>

      {/* График выручки за 14 дней */}
      {can('reports.view') && daily.length > 0 && (
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-700">
            Выручка за 14 дней
          </h2>
          <div className="flex h-36 items-end gap-1">
            {daily.map((d) => (
              <div
                key={d.date}
                className="group flex flex-1 flex-col items-center"
              >
                <div
                  className="w-full rounded-t bg-indigo-500 transition group-hover:bg-indigo-600"
                  style={{ height: `${Math.max(2, (d.amount / maxDaily) * 100)}%` }}
                  title={`${d.date}: ${money(d.amount)}`}
                />
                <span className="mt-1 text-[9px] text-slate-400">
                  {d.date.slice(8, 10)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Срочные заказы */}
        <Panel title="🔥 Срочные заказы">
          {soon.length === 0 ? (
            <Empty text="Срочных нет" />
          ) : (
            soon.slice(0, 6).map((o) => (
              <Row key={o.id}>
                <span>
                  №{o.orderNumber} · {o.client?.fullName ?? o.client?.phone ?? '—'}
                </span>
                <span className="font-medium text-rose-600">
                  {new Date(o.deadline).toLocaleDateString('ru-RU')}
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
            debts.slice(0, 6).map((d) => (
              <Row key={d.orderId}>
                <span>
                  №{d.orderNumber} · {d.client}
                </span>
                <span className="font-semibold text-rose-600">{money(d.debt)}</span>
              </Row>
            ))
          )}
        </Panel>

        {/* Склад */}
        <Panel title="Заканчивается на складе">
          {low.length === 0 ? (
            <Empty text="Всё в норме" />
          ) : (
            low.map((l, i) => (
              <Row key={i}>
                <span>{l.productName}</span>
                <span className="font-semibold text-amber-600">
                  {l.quantity} {l.unit} (порог {l.minStock})
                </span>
              </Row>
            ))
          )}
        </Panel>

        {/* Задачи */}
        <Panel title="Открытые задачи">
          {openTasks.length === 0 ? (
            <Empty text="Задач нет" />
          ) : (
            openTasks.slice(0, 6).map((t) => (
              <Row key={t.id}>
                <span>{t.title}</span>
                <span className="text-slate-500">{t.assignedUser?.fullName ?? '—'}</span>
              </Row>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="mb-3 font-semibold text-slate-700">{title}</h2>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-4 text-center text-sm text-slate-400">{text}</div>;
}
