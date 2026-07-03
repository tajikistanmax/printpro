'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DEFAULT_COMPANY_ID } from '@/lib/config';
import {
  PageHeader,
  StatGrid,
  StatCard,
  Segmented,
  Card,
  SectionTitle,
  TableCard,
  Button,
  Badge,
  EmptyState,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' c.';
}

const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: 'Принят',
  AWAITING_DESIGN: 'Ожидает макет',
  IN_DESIGN: 'В дизайне',
  DESIGN_APPROVAL: 'На согласовании',
  DESIGN_APPROVED: 'Согласован',
  IN_PROGRESS: 'В производстве',
  READY: 'Готов',
  DELIVERED: 'Выдан',
  REWORK: 'Переделка',
  CANCELLED: 'Отменён',
};

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
  const [matUsage, setMatUsage] = useState<any>(null);
  const [byStatus, setByStatus] = useState<any[]>([]);
  const [overdue, setOverdue] = useState<any[]>([]);

  // Кол-во дней в графике зависит от периода (С6: было жёстко 14)
  const dailyDays = period === 'month' ? 30 : 7;

  useEffect(() => {
    const { from, to } = periodRange(period);
    const q = `companyId=${cid}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    api.get(`/reports/summary?${q}`).then(setSummary).catch(() => {});
    api.get(`/reports/sales-by-item?${q}`).then(setSales).catch(() => {});
    api.get(`/reports/daily?companyId=${cid}&days=${dailyDays}`).then(setDaily).catch(() => {});
    api.get(`/reports/debts?companyId=${cid}`).then(setDebts).catch(() => {});
    api.get(`/reports/staff?${q}`).then(setStaff).catch(() => {});
    api.get(`/reports/profit?${q}`).then(setProfit).catch(() => {});
    api
      .get(`/reports/equipment-load?companyId=${cid}`)
      .then(setEqLoad)
      .catch(() => {});
    api.get(`/reports/expenses?${q}`).then(setExpenses).catch(() => {});
    api.get(`/reports/materials-usage?${q}`).then(setMatUsage).catch(() => {});
    api.get(`/reports/orders-by-status?${q}`).then(setByStatus).catch(() => {});
    api.get(`/reports/overdue?companyId=${cid}`).then(setOverdue).catch(() => {});
  }, [cid, period, dailyDays]);

  const maxDaily = Math.max(1, ...daily.map((d) => d.amount));

  return (
    <div className="print-area">
      <PageHeader
        icon="reports"
        title="Отчёты и финансы"
        subtitle="Выручка, прибыль, долги и эффективность"
        actions={
          <div className="no-print flex items-center gap-2">
            <Segmented
              options={[
                { key: 'today', label: 'Сегодня' },
                { key: 'week', label: 'Неделя' },
                { key: 'month', label: 'Месяц' },
              ]}
              active={period}
              onChange={setPeriod}
            />
            <Button variant="ghost" onClick={() => window.print()}><NavIcon name="print" className="h-4 w-4" />PDF</Button>
          </div>
        }
      />

      {/* KPI */}
      {summary && (
        <StatGrid cols={4}>
          <StatCard icon="cash" tone="emerald" label="Выручка деньгами" value={money(summary.collected)} highlight />
          <StatCard icon="quotes" tone="slate" label="Выставлено по заказам" value={money(summary.billed)} />
          {summary.returns > 0 && (
            <StatCard icon="alert" tone="rose" label="Возвраты" value={money(summary.returns)} />
          )}
          {summary.returns > 0 && (
            <StatCard icon="reports" tone="sky" label="Чистая выручка" value={money(summary.net)} sub="выставлено − возвраты" />
          )}
          <StatCard icon="orders" tone="indigo" label="Заказов" value={summary.ordersCount} />
          <StatCard icon="reports" tone="violet" label="Средний чек" value={money(summary.avgCheck)} />
        </StatGrid>
      )}

      {/* Способы оплаты */}
      {summary && (
        <Card className="mb-6">
          <SectionTitle>Способы оплаты</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MethodCard label="Наличные" value={summary.byMethod.cash} />
            <MethodCard label="Карта" value={summary.byMethod.card} />
            <MethodCard label="QR" value={summary.byMethod.qr ?? 0} />
            <MethodCard label="Перевод" value={summary.byMethod.transfer} />
            <MethodCard label="В долг" value={summary.byMethod.debt} danger />
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* График выручки */}
        <Card>
          <SectionTitle>Выручка по дням ({dailyDays} дн.)</SectionTitle>
          {daily.length === 0 ? (
            <EmptyState icon="reports" title="Нет данных" />
          ) : (
            <div className="flex h-40 items-end gap-1">
              {daily.map((d) => (
                <div key={d.date} className="group flex h-full flex-1 flex-col items-center justify-end">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t bg-indigo-500 transition group-hover:bg-indigo-600"
                      style={{ height: `${Math.max(2, (d.amount / maxDaily) * 100)}%` }}
                      title={`${d.date}: ${money(d.amount)}`}
                    />
                  </div>
                  <span className="mt-1 text-[9px] text-slate-400">{d.date.slice(8, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Долги */}
        <Card>
          <SectionTitle
            right={
              <div className="flex items-center gap-2">
                {debts && debts.items.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      downloadCSV(
                        'debts.csv',
                        ['Заказ', 'Клиент', 'Телефон', 'Итого', 'Оплачено', 'Долг'],
                        debts.items.map((d: any) => [d.orderNumber, d.client, d.phone, d.total, d.paid, d.debt]),
                      )
                    }
                  >
                    <NavIcon name="download" className="h-4 w-4" />CSV
                  </Button>
                )}
                {debts && (
                  <span className="font-semibold text-rose-600">
                    {money(debts.total)} · {debts.count}
                  </span>
                )}
              </div>
            }
          >
            Долги клиентов
          </SectionTitle>
          {!debts || debts.items.length === 0 ? (
            <EmptyState icon="clients" title="Долгов нет" />
          ) : (
            <div className="max-h-40 space-y-1 overflow-auto">
              {debts.items.map((d: any) => (
                <div key={d.orderId} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-700">
                  <span className="text-slate-600 dark:text-slate-300">№{d.orderNumber} · {d.client}</span>
                  <span className="font-medium text-rose-600">{money(d.debt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Топ услуг/товаров */}
      <Card className="mt-6">
        <SectionTitle
          right={
            sales.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  downloadCSV(
                    'sales.csv',
                    ['Наименование', 'Тип', 'Количество', 'Выручка'],
                    sales.map((s) => [s.name, s.type === 'SERVICE' ? 'Услуга' : 'Товар', s.qty, s.revenue]),
                  )
                }
              >
                <NavIcon name="download" className="h-4 w-4" />Экспорт CSV
              </Button>
            )
          }
        >
          Продажи по услугам и товарам
        </SectionTitle>
        {sales.length === 0 ? (
          <EmptyState icon="services" title="Нет продаж за период" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Тип</th>
                  <th className="text-right">Кол-во</th>
                  <th className="text-right">Выручка</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={i}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{s.name}</td>
                    <td>{s.type === 'SERVICE' ? <Badge tone="violet">Услуга</Badge> : <Badge tone="sky">Товар</Badge>}</td>
                    <td className="text-right text-slate-500">{s.qty}</td>
                    <td className="text-right font-semibold text-slate-800 dark:text-slate-100">{money(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Прибыль по заказам */}
      <Card className="mt-6">
        <SectionTitle
          right={
            profit && profit.items.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  downloadCSV(
                    'profit.csv',
                    ['Заказ', 'Клиент', 'Выручка', 'Себестоимость', 'Прибыль', 'Маржа %'],
                    profit.items.map((p: any) => [p.orderNumber, p.client, p.revenue, p.cost, p.profit, p.margin]),
                  )
                }
              >
                <NavIcon name="download" className="h-4 w-4" />Экспорт CSV
              </Button>
            )
          }
        >
          Прибыль по заказам
        </SectionTitle>

        {profit && (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div className="text-xs text-slate-500">Выручка</div>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{money(profit.revenue)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div className="text-xs text-slate-500">Себестоимость</div>
              <div className="text-lg font-bold text-amber-600">{money(profit.cost)}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
              <div className="text-xs text-slate-500">Прибыль</div>
              <div className="text-lg font-bold text-emerald-600">{money(profit.profit)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div className="text-xs text-slate-500">Маржа</div>
              <div className="text-lg font-bold text-indigo-600">{profit.margin}%</div>
            </div>
          </div>
        )}

        {!profit || profit.items.length === 0 ? (
          <EmptyState icon="reports" title="Нет данных" hint="Прибыль считается, если у услуг указана себестоимость." />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Клиент</th>
                  <th className="text-right">Выручка</th>
                  <th className="text-right">Себест-ть</th>
                  <th className="text-right">Прибыль</th>
                  <th className="text-right">Маржа</th>
                </tr>
              </thead>
              <tbody>
                {profit.items.slice(0, 50).map((p: any) => (
                  <tr key={p.orderId}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">№{p.orderNumber}</td>
                    <td className="text-slate-500">{p.client}</td>
                    <td className="text-right text-slate-600 dark:text-slate-300">{money(p.revenue)}</td>
                    <td className="text-right text-amber-600">{money(p.cost)}</td>
                    <td className="text-right font-semibold text-emerald-600">{money(p.profit)}</td>
                    <td className="text-right text-slate-500">{p.margin}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Расходы по категориям */}
      {expenses && expenses.total > 0 && (
        <Card className="mt-6">
          <SectionTitle
            right={
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    downloadCSV(
                      'expenses.csv',
                      ['Категория', 'Сумма'],
                      expenses.byCategory.map((c: any) => [c.category, c.amount]),
                    )
                  }
                >
                  <NavIcon name="download" className="h-4 w-4" />CSV
                </Button>
                <span className="font-semibold text-rose-600">{money(expenses.total)}</span>
              </div>
            }
          >
            Расходы по категориям
          </SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {expenses.byCategory.map((c: any) => (
              <div key={c.category} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
                <span className="text-slate-600 dark:text-slate-300">{c.category}</span>
                <span className="font-medium text-slate-800 dark:text-slate-100">{money(c.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Загрузка оборудования */}
      {eqLoad.length > 0 && (
        <Card className="mt-6">
          <SectionTitle
            right={
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  downloadCSV(
                    'equipment-load.csv',
                    ['Оборудование', 'Тип', 'В очереди', 'В работе', 'Готово', 'Брак'],
                    eqLoad.map((e: any) => [e.name, e.type, e.inQueue, e.inWork, e.completed, e.rework || 0]),
                  )
                }
              >
                <NavIcon name="download" className="h-4 w-4" />CSV
              </Button>
            }
          >
            Загрузка оборудования
          </SectionTitle>
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Оборудование</th>
                  <th>Тип</th>
                  <th className="text-right">В очереди</th>
                  <th className="text-right">В работе</th>
                  <th className="text-right">Готово</th>
                  <th className="text-right">Брак</th>
                </tr>
              </thead>
              <tbody>
                {eqLoad.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">
                      {e.name}
                      {e.status !== 'ACTIVE' && (
                        <Badge tone="amber" className="ml-2">{e.status === 'REPAIR' ? 'ремонт' : 'выкл'}</Badge>
                      )}
                    </td>
                    <td className="text-slate-500">{e.type}</td>
                    <td className="text-right text-slate-500">{e.inQueue}</td>
                    <td className="text-right font-medium text-sky-600">{e.inWork}</td>
                    <td className="text-right text-emerald-600">{e.completed}</td>
                    <td className="text-right text-rose-600">{e.rework || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Просроченные заказы */}
      {overdue.length > 0 && (
        <Card className="mt-6">
          <SectionTitle
            right={
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    downloadCSV(
                      'overdue.csv',
                      ['Заказ', 'Клиент', 'Статус', 'Срок', 'Менеджер', 'Долг'],
                      overdue.map((o) => [o.orderNumber, o.client, STATUS_LABELS[o.status] ?? o.status, o.deadline ? new Date(o.deadline).toLocaleString('ru-RU') : '', o.manager, o.balanceDue]),
                    )
                  }
                >
                  <NavIcon name="download" className="h-4 w-4" />CSV
                </Button>
                <span className="font-semibold text-rose-600">{overdue.length}</span>
              </div>
            }
          >
            Просроченные заказы
          </SectionTitle>
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Клиент</th>
                  <th>Статус</th>
                  <th>Срок</th>
                  <th>Менеджер</th>
                  <th className="text-right">Долг</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((o) => (
                  <tr key={o.orderId}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">№{o.orderNumber}</td>
                    <td className="text-slate-500">{o.client}</td>
                    <td><Badge tone="amber">{STATUS_LABELS[o.status] ?? o.status}</Badge></td>
                    <td className="text-rose-600">{o.deadline ? new Date(o.deadline).toLocaleDateString('ru-RU') : '—'}</td>
                    <td className="text-slate-500">{o.manager || '—'}</td>
                    <td className="text-right font-medium text-rose-600">{o.balanceDue > 0 ? money(o.balanceDue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Заказы по статусам */}
      {byStatus.length > 0 && (
        <Card className="mt-6">
          <SectionTitle>Заказы по статусам (за период)</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {byStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
                <span className="text-slate-600 dark:text-slate-300">{STATUS_LABELS[s.status] ?? s.status}</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100">{s.count} · {money(s.total)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Расход материалов */}
      {matUsage && matUsage.items.length > 0 && (
        <Card className="mt-6">
          <SectionTitle
            right={
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    downloadCSV(
                      'materials-usage.csv',
                      ['Материал', 'Расход', 'Списано', 'Итого', 'Ед.', 'Себестоимость'],
                      matUsage.items.map((m: any) => [m.name, m.used, m.writeOff, m.total, m.unit, m.cost]),
                    )
                  }
                >
                  <NavIcon name="download" className="h-4 w-4" />CSV
                </Button>
                <span className="font-semibold text-slate-700 dark:text-slate-200">{money(matUsage.totalCost)}</span>
              </div>
            }
          >
            Расход материалов за период
          </SectionTitle>
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Материал</th>
                  <th className="text-right">Расход</th>
                  <th className="text-right">Списано</th>
                  <th className="text-right">Итого</th>
                  <th className="text-right">Себест-ть</th>
                </tr>
              </thead>
              <tbody>
                {matUsage.items.slice(0, 50).map((m: any) => (
                  <tr key={m.productId}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{m.name}</td>
                    <td className="text-right text-slate-600 dark:text-slate-300">{m.used} {m.unit}</td>
                    <td className="text-right text-rose-600">{m.writeOff || ''}</td>
                    <td className="text-right font-medium text-slate-700 dark:text-slate-200">{m.total} {m.unit}</td>
                    <td className="text-right text-amber-600">{money(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Эффективность сотрудников */}
      <Card className="mt-6">
        <SectionTitle
          right={
            staff.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  downloadCSV(
                    'staff.csv',
                    ['Сотрудник', 'Роль', 'Заказов', 'Сумма продаж', 'Произв.', 'Задач'],
                    staff.map((u: any) => [u.name, u.role, u.ordersCreated, u.salesSum, u.productionDone, u.tasksDone]),
                  )
                }
              >
                <NavIcon name="download" className="h-4 w-4" />CSV
              </Button>
            )
          }
        >
          Эффективность сотрудников
        </SectionTitle>
        {staff.length === 0 ? (
          <EmptyState icon="staff" title="Нет данных" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Роль</th>
                  <th className="text-right">Заказов</th>
                  <th className="text-right">Сумма продаж</th>
                  <th className="text-right">Произв.</th>
                  <th className="text-right">Задач</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{u.name}</td>
                    <td className="text-slate-500">{u.role}</td>
                    <td className="text-right text-slate-500">{u.ordersCreated}</td>
                    <td className="text-right font-semibold text-slate-800 dark:text-slate-100">{money(u.salesSum)}</td>
                    <td className="text-right text-slate-500">{u.productionDone}</td>
                    <td className="text-right text-slate-500">{u.tasksDone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function MethodCard({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-800/50">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${danger ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100'}`}>
        {money(value)}
      </div>
    </div>
  );
}
