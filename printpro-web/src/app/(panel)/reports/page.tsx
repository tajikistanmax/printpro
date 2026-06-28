'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

// Выгрузка таблицы в CSV (открывается в Excel)
function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  // BOM — чтобы Excel правильно показал кириллицу
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Период → даты (локально)
function periodRange(period: string): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (period === 'today') {
    from.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
  } else {
    // month
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function ReportsPage() {
  const cid = DEFAULT_COMPANY_ID;
  const [period, setPeriod] = useState('month');
  const [summary, setSummary] = useState<any>(null);
  const [daily, setDaily] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [debts, setDebts] = useState<any>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [profit, setProfit] = useState<any>(null);
  const [eqLoad, setEqLoad] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any>(null);

  useEffect(() => {
    const { from, to } = periodRange(period);
    const q = `companyId=${cid}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    api.get(`/reports/summary?${q}`).then(setSummary).catch(() => {});
    api.get(`/reports/sales-by-item?${q}`).then(setSales).catch(() => {});
    api.get(`/reports/daily?companyId=${cid}&days=14`).then(setDaily).catch(() => {});
    api.get(`/reports/debts?companyId=${cid}`).then(setDebts).catch(() => {});
    api.get(`/reports/staff?${q}`).then(setStaff).catch(() => {});
    api.get(`/reports/profit?${q}`).then(setProfit).catch(() => {});
    api
      .get(`/reports/equipment-load?companyId=${cid}`)
      .then(setEqLoad)
      .catch(() => {});
    api.get(`/reports/expenses?${q}`).then(setExpenses).catch(() => {});
  }, [cid, period]);

  const maxDaily = Math.max(1, ...daily.map((d) => d.amount));

  const kpis = summary
    ? [
        { label: 'Выручка деньгами', value: money(summary.collected), color: 'text-emerald-600' },
        { label: 'Выставлено по заказам', value: money(summary.billed), color: 'text-slate-800' },
        { label: 'Заказов', value: String(summary.ordersCount), color: 'text-indigo-600' },
        { label: 'Средний чек', value: money(summary.avgCheck), color: 'text-sky-600' },
      ]
    : [];

  return (
    <div className="print-area">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Отчёты и финансы</h1>
        <div className="no-print flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-white p-1 shadow-sm">
            {[
              { k: 'today', l: 'Сегодня' },
              { k: 'week', l: 'Неделя' },
              { k: 'month', l: 'Месяц' },
            ].map((p) => (
              <button
                key={p.k}
                onClick={() => setPeriod(p.k)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  period === p.k
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {p.l}
              </button>
            ))}
          </div>
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            🖨 PDF
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl bg-white p-5 shadow-sm">
            <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
            <div className="mt-1 text-sm text-slate-500">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Способы оплаты */}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MethodCard label="Наличные" value={summary.byMethod.cash} />
          <MethodCard label="Карта" value={summary.byMethod.card} />
          <MethodCard label="QR" value={summary.byMethod.qr ?? 0} />
          <MethodCard label="Перевод" value={summary.byMethod.transfer} />
          <MethodCard label="В долг" value={summary.byMethod.debt} danger />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* График выручки */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-700">
            Выручка по дням (14 дней)
          </h2>
          {daily.length === 0 ? (
            <p className="text-sm text-slate-400">Нет данных</p>
          ) : (
            <div className="flex h-40 items-end gap-1">
              {daily.map((d) => (
                <div
                  key={d.date}
                  className="group flex h-full flex-1 flex-col items-center justify-end"
                >
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t bg-indigo-500 transition group-hover:bg-indigo-600"
                      style={{
                        height: `${Math.max(2, (d.amount / maxDaily) * 100)}%`,
                      }}
                      title={`${d.date}: ${money(d.amount)}`}
                    />
                  </div>
                  <span className="mt-1 text-[9px] text-slate-400">
                    {d.date.slice(8, 10)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Долги */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Долги клиентов</h2>
            <div className="flex items-center gap-2">
              {debts && debts.items.length > 0 && (
                <button
                  onClick={() =>
                    downloadCSV(
                      'debts.csv',
                      ['Заказ', 'Клиент', 'Телефон', 'Итого', 'Оплачено', 'Долг'],
                      debts.items.map((d: any) => [
                        d.orderNumber,
                        d.client,
                        d.phone,
                        d.total,
                        d.paid,
                        d.debt,
                      ]),
                    )
                  }
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  ⬇ CSV
                </button>
              )}
              {debts && (
                <span className="font-semibold text-rose-600">
                  {money(debts.total)} · {debts.count}
                </span>
              )}
            </div>
          </div>
          {!debts || debts.items.length === 0 ? (
            <p className="text-sm text-slate-400">Долгов нет</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-auto">
              {debts.items.map((d: any) => (
                <div
                  key={d.orderId}
                  className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0"
                >
                  <span className="text-slate-600">
                    №{d.orderNumber} · {d.client}
                  </span>
                  <span className="font-medium text-rose-600">{money(d.debt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Топ услуг/товаров */}
      <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">
            Продажи по услугам и товарам
          </h2>
          {sales.length > 0 && (
            <button
              onClick={() =>
                downloadCSV(
                  'sales.csv',
                  ['Наименование', 'Тип', 'Количество', 'Выручка'],
                  sales.map((s) => [
                    s.name,
                    s.type === 'SERVICE' ? 'Услуга' : 'Товар',
                    s.qty,
                    s.revenue,
                  ]),
                )
              }
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              ⬇ Экспорт CSV
            </button>
          )}
        </div>
        {sales.length === 0 ? (
          <p className="text-sm text-slate-400">Нет продаж за период</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-400">
                <th className="py-2 font-medium">Наименование</th>
                <th className="py-2 font-medium">Тип</th>
                <th className="py-2 text-right font-medium">Кол-во</th>
                <th className="py-2 text-right font-medium">Выручка</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-slate-700">{s.name}</td>
                  <td className="py-2 text-slate-400">
                    {s.type === 'SERVICE' ? 'Услуга' : 'Товар'}
                  </td>
                  <td className="py-2 text-right text-slate-500">{s.qty}</td>
                  <td className="py-2 text-right font-medium text-slate-800">
                    {money(s.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Прибыль по заказам */}
      <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">Прибыль по заказам</h2>
          {profit && profit.items.length > 0 && (
            <button
              onClick={() =>
                downloadCSV(
                  'profit.csv',
                  ['Заказ', 'Клиент', 'Выручка', 'Себестоимость', 'Прибыль', 'Маржа %'],
                  profit.items.map((p: any) => [
                    p.orderNumber,
                    p.client,
                    p.revenue,
                    p.cost,
                    p.profit,
                    p.margin,
                  ]),
                )
              }
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              ⬇ Экспорт CSV
            </button>
          )}
        </div>

        {/* Итоги прибыли */}
        {profit && (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Выручка</div>
              <div className="text-lg font-bold text-slate-800">
                {money(profit.revenue)}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Себестоимость</div>
              <div className="text-lg font-bold text-amber-600">
                {money(profit.cost)}
              </div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-xs text-slate-500">Прибыль</div>
              <div className="text-lg font-bold text-emerald-600">
                {money(profit.profit)}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Маржа</div>
              <div className="text-lg font-bold text-indigo-600">
                {profit.margin}%
              </div>
            </div>
          </div>
        )}

        {!profit || profit.items.length === 0 ? (
          <p className="text-sm text-slate-400">
            Нет данных. Прибыль считается, если у услуг указана себестоимость.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-400">
                <th className="py-2 font-medium">Заказ</th>
                <th className="py-2 font-medium">Клиент</th>
                <th className="py-2 text-right font-medium">Выручка</th>
                <th className="py-2 text-right font-medium">Себест-ть</th>
                <th className="py-2 text-right font-medium">Прибыль</th>
                <th className="py-2 text-right font-medium">Маржа</th>
              </tr>
            </thead>
            <tbody>
              {profit.items.slice(0, 50).map((p: any) => (
                <tr key={p.orderId} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-slate-700">№{p.orderNumber}</td>
                  <td className="py-2 text-slate-400">{p.client}</td>
                  <td className="py-2 text-right text-slate-600">{money(p.revenue)}</td>
                  <td className="py-2 text-right text-amber-600">{money(p.cost)}</td>
                  <td className="py-2 text-right font-medium text-emerald-600">
                    {money(p.profit)}
                  </td>
                  <td className="py-2 text-right text-slate-500">{p.margin}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Расходы по категориям */}
      {expenses && expenses.total > 0 && (
        <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Расходы по категориям</h2>
            <span className="font-semibold text-rose-600">{money(expenses.total)}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {expenses.byCategory.map((c: any) => (
              <div
                key={c.category}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="text-slate-600">{c.category}</span>
                <span className="font-medium text-slate-800">{money(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Загрузка оборудования */}
      {eqLoad.length > 0 && (
        <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Загрузка оборудования</h2>
            <button
              onClick={() =>
                downloadCSV(
                  'equipment-load.csv',
                  ['Оборудование', 'Тип', 'В очереди', 'В работе', 'Готово', 'Брак'],
                  eqLoad.map((e: any) => [
                    e.name,
                    e.type,
                    e.inQueue,
                    e.inWork,
                    e.completed,
                    e.rework || 0,
                  ]),
                )
              }
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              ⬇ CSV
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-400">
                <th className="py-2 font-medium">Оборудование</th>
                <th className="py-2 font-medium">Тип</th>
                <th className="py-2 text-right font-medium">В очереди</th>
                <th className="py-2 text-right font-medium">В работе</th>
                <th className="py-2 text-right font-medium">Готово</th>
                <th className="py-2 text-right font-medium">Брак</th>
              </tr>
            </thead>
            <tbody>
              {eqLoad.map((e) => (
                <tr key={e.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-slate-700">
                    {e.name}
                    {e.status !== 'ACTIVE' && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-700">
                        {e.status === 'REPAIR' ? 'ремонт' : 'выкл'}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-slate-400">{e.type}</td>
                  <td className="py-2 text-right text-slate-500">{e.inQueue}</td>
                  <td className="py-2 text-right font-medium text-sky-600">
                    {e.inWork}
                  </td>
                  <td className="py-2 text-right text-emerald-600">{e.completed}</td>
                  <td className="py-2 text-right text-rose-600">{e.rework || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Эффективность сотрудников */}
      <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">
            Эффективность сотрудников
          </h2>
          {staff.length > 0 && (
            <button
              onClick={() =>
                downloadCSV(
                  'staff.csv',
                  ['Сотрудник', 'Роль', 'Заказов', 'Сумма продаж', 'Произв.', 'Задач'],
                  staff.map((u: any) => [
                    u.name,
                    u.role,
                    u.ordersCreated,
                    u.salesSum,
                    u.productionDone,
                    u.tasksDone,
                  ]),
                )
              }
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              ⬇ CSV
            </button>
          )}
        </div>
        {staff.length === 0 ? (
          <p className="text-sm text-slate-400">Нет данных</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-400">
                <th className="py-2 font-medium">Сотрудник</th>
                <th className="py-2 font-medium">Роль</th>
                <th className="py-2 text-right font-medium">Заказов</th>
                <th className="py-2 text-right font-medium">Сумма продаж</th>
                <th className="py-2 text-right font-medium">Произв.</th>
                <th className="py-2 text-right font-medium">Задач</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-slate-700">{u.name}</td>
                  <td className="py-2 text-slate-400">{u.role}</td>
                  <td className="py-2 text-right text-slate-500">
                    {u.ordersCreated}
                  </td>
                  <td className="py-2 text-right font-medium text-slate-800">
                    {money(u.salesSum)}
                  </td>
                  <td className="py-2 text-right text-slate-500">
                    {u.productionDone}
                  </td>
                  <td className="py-2 text-right text-slate-500">{u.tasksDone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MethodCard({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div
        className={`text-lg font-bold ${danger ? 'text-rose-600' : 'text-slate-800'}`}
      >
        {money(value)}
      </div>
    </div>
  );
}
