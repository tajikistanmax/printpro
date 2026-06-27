'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import { useAuth } from '@/lib/auth';

export default function DashboardPage() {
  const { user } = useAuth();
  const cid = DEFAULT_COMPANY_ID;
  const [orders, setOrders] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [low, setLow] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    api.get(`/orders?companyId=${cid}`).then(setOrders).catch(() => {});
    api.get(`/orders/debts?companyId=${cid}`).then(setDebts).catch(() => {});
    api.get(`/stock/low?companyId=${cid}`).then(setLow).catch(() => {});
    api.get(`/tasks?companyId=${cid}`).then(setTasks).catch(() => {});
  }, [cid]);

  const totalDebt = debts.reduce((s, d) => s + (d.debt ?? 0), 0);
  const openTasks = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');

  const cards = [
    { label: 'Всего заказов', value: orders.length, color: 'bg-indigo-500' },
    { label: 'Долги (сумма)', value: totalDebt + ' c.', color: 'bg-rose-500' },
    { label: 'Мало на складе', value: low.length, color: 'bg-amber-500' },
    { label: 'Открытых задач', value: openTasks.length, color: 'bg-emerald-500' },
  ];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-800">
        Здравствуйте, {user?.fullName}
      </h1>
      <p className="mb-6 text-slate-500">Обзор работы типографии</p>

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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Долги */}
        <Panel title="Должники">
          {debts.length === 0 ? (
            <Empty text="Долгов нет" />
          ) : (
            debts.map((d) => (
              <Row key={d.orderId}>
                <span>
                  №{d.orderNumber} · {d.client}
                </span>
                <span className="font-semibold text-rose-600">{d.debt} c.</span>
              </Row>
            ))
          )}
        </Panel>

        {/* Оповещения склада */}
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

        {/* Последние заказы */}
        <Panel title="Последние заказы">
          {orders.length === 0 ? (
            <Empty text="Заказов пока нет" />
          ) : (
            orders.slice(0, 6).map((o) => (
              <Row key={o.id}>
                <span>
                  №{o.orderNumber} · {o.client?.fullName ?? o.client?.phone ?? '—'}
                </span>
                <span className="text-slate-500">{o.total} c.</span>
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
