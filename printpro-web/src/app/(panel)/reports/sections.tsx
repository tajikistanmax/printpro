'use client';

// Компоненты-секции для вкладок страницы отчётов.
// Каждая секция сама грузит нужные эндпоинты по общим фильтрам (props)
// и рендерит карточки/таблицы с экспортом в CSV. Каждый запрос ведёт своё
// состояние loading/error/success (см. useReport): при 403/500/сети показываем
// ошибку с кнопкой «Повторить», а не пустой «Нет данных».

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  Card,
  SectionTitle,
  StatGrid,
  StatCard,
  Segmented,
  Button,
  Badge,
  EmptyState,
  Field,
  Select,
} from '@/components/ui';
import NavIcon from '@/lib/NavIcons';
import {
  money,
  pct,
  num,
  fmtDate,
  downloadCSV,
  buildQuery,
  ORDER_TYPE_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  URGENCY_LABEL,
  type Summary,
  type Timeseries,
  type SalesByClient,
  type OrdersRegistry,
  type SalesItem,
  type SalesByCategory,
  type CategoryRow,
  type Abc,
  type Profit,
  type Cashflow,
  type Expenses,
  type Receivables,
  type Payables,
  type Inventory,
  type StockMovements,
  type Purchasing,
  type Production,
  type StaffRow,
} from './lib';

/* ================================================================== */
/*  Общие пропсы фильтров                                              */
/* ================================================================== */

export interface Filters {
  cid: string;
  from: string;
  to: string;
  branchId: string;
  groupBy: 'day' | 'week' | 'month';
  compare: boolean;
}

/** Базовый query companyId&from&to&branchId. */
function baseQuery(
  f: Filters,
  extra?: Record<string, string | number | boolean | undefined>,
) {
  return buildQuery({
    companyId: f.cid,
    from: f.from,
    to: f.to,
    branchId: f.branchId || undefined,
    ...extra,
  });
}

/* ================================================================== */
/*  Загрузка данных секции: loading / error / success + повтор        */
/* ================================================================== */

type AsyncState<T> = { data: T | null; loading: boolean; error: string | null };

/**
 * Грузит один эндпоинт отчёта и отдаёт статус загрузки/ошибки.
 * Ошибку НЕ гасим — показываем пользователю с возможностью повторить.
 */
function useReport<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher()
      .then((d) => {
        if (alive) setState({ data: d, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (alive)
          setState({
            data: null,
            loading: false,
            error: e instanceof Error ? e.message : 'Ошибка загрузки',
          });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** Обёртка: пока грузится — «Загрузка…», при ошибке — сообщение + «Повторить». */
function ReportGate({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (loading) return <EmptyState icon="reports" title="Загрузка…" />;
  if (error)
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <EmptyState icon="alert" title="Не удалось загрузить" hint={error} />
        <Button variant="ghost" size="sm" onClick={onRetry}>
          <NavIcon name="refresh" className="h-4 w-4" />
          Повторить
        </Button>
      </div>
    );
  return <>{children}</>;
}

/* ================================================================== */
/*  Мелкие переиспользуемые UI-детали                                 */
/* ================================================================== */

/** Кнопка экспорта таблицы в CSV. */
function ExportBtn({
  headers,
  rows,
  name,
  disabled,
}: {
  headers: string[];
  rows: (string | number)[][];
  name: string;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={() => downloadCSV(headers, rows, name)}
    >
      <NavIcon name="download" className="h-4 w-4" />
      CSV
    </Button>
  );
}

/** Дельта в процентах со стрелкой и цветом. */
function Delta({ value }: { value: number | undefined }) {
  if (value === undefined || value === null || !isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span
      className={`ml-1 text-xs font-semibold ${
        up ? 'text-emerald-600' : 'text-rose-600'
      }`}
    >
      {up ? '▲' : '▼'} {pct(Math.abs(value))}
    </span>
  );
}

/** Простой столбчатый график на div (без библиотек). */
function BarChart({
  data,
  color = 'bg-indigo-500',
  hoverColor = 'group-hover:bg-indigo-600',
}: {
  data: { label: string; value: number; title: string }[];
  color?: string;
  hoverColor?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-44 items-end gap-1 overflow-x-auto">
      {data.map((d, i) => (
        <div
          key={`${d.label}-${d.title}-${i}`}
          className="group flex h-full min-w-[10px] flex-1 flex-col items-center justify-end"
        >
          <div className="flex w-full flex-1 items-end">
            <div
              className={`w-full rounded-t ${color} ${hoverColor} transition`}
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
              title={d.title}
            />
          </div>
          <span className="mt-1 truncate text-[9px] text-slate-400">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Плитка-метрика на сером фоне. */
function Mini({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'indigo' | 'sky';
}) {
  const colors: Record<string, string> = {
    slate: 'text-slate-800 dark:text-slate-100',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
    indigo: 'text-indigo-600',
    sky: 'text-sky-600',
  };
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${colors[tone]}`}>{value}</div>
    </div>
  );
}

/** Строка «метод оплаты». */
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
    <div className="rounded-xl border border-slate-200/70 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-800/50">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`text-lg font-bold ${
          danger ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100'
        }`}
      >
        {money(value)}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  ВКЛАДКА: ОБЗОР                                                     */
/* ================================================================== */

export function OverviewSection({ f }: { f: Filters }) {
  const sum = useReport<Summary>(
    () =>
      api.get<Summary>(
        `/reports/summary?${baseQuery(f, f.compare ? { compare: 1 } : {})}`,
      ),
    [f],
  );
  const tsr = useReport<Timeseries>(
    () =>
      api.get<Timeseries>(
        `/reports/timeseries?${baseQuery(f, { groupBy: f.groupBy })}`,
      ),
    [f],
  );

  const summary = sum.data;
  if (!summary)
    return (
      <ReportGate loading={sum.loading} error={sum.error} onRetry={sum.reload}>
        {null}
      </ReportGate>
    );

  const cmp = summary.compare;
  const bars =
    tsr.data?.buckets.map((b) => ({
      label: b.label,
      value: b.collected,
      title: `${b.label}: ${money(b.collected)} (выст. ${money(b.billed)})`,
    })) ?? [];

  return (
    <div>
      <StatGrid cols={4}>
        <StatCard
          icon="cash"
          tone="emerald"
          label="Выручка деньгами"
          value={
            <>
              {money(summary.collected)}
              {cmp && <Delta value={cmp.deltas.collectedPct} />}
            </>
          }
          highlight
        />
        <StatCard
          icon="quotes"
          tone="slate"
          label="Выставлено"
          value={
            <>
              {money(summary.billed)}
              {cmp && <Delta value={cmp.deltas.billedPct} />}
            </>
          }
        />
        <StatCard
          icon="reports"
          tone="sky"
          label="Чистая выручка"
          value={
            <>
              {money(summary.net)}
              {cmp && <Delta value={cmp.deltas.netPct} />}
            </>
          }
          sub="выставлено − возвраты"
        />
        <StatCard
          icon="reports"
          tone="violet"
          label="Валовая прибыль"
          value={
            <>
              {money(summary.grossProfit)}
              {cmp && <Delta value={cmp.deltas.grossProfitPct} />}
            </>
          }
          sub={`маржа ${pct(summary.margin)}`}
        />
        <StatCard
          icon="orders"
          tone="indigo"
          label="Заказов"
          value={
            <>
              {summary.ordersCount}
              {cmp && <Delta value={cmp.deltas.ordersCountPct} />}
            </>
          }
        />
        <StatCard
          icon="reports"
          tone="slate"
          label="Средний чек"
          value={
            <>
              {money(summary.avgCheck)}
              {cmp && <Delta value={cmp.deltas.avgCheckPct} />}
            </>
          }
        />
        <StatCard
          icon="alert"
          tone="rose"
          label="Долг за период"
          value={money(summary.debt)}
        />
        <StatCard
          icon="clients"
          tone="amber"
          label="Новых клиентов"
          value={summary.newClients}
        />
      </StatGrid>

      {/* доп. индикаторы */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {summary.cashCollectionRate !== undefined && (
          <Mini
            label="Инкассация"
            value={pct(summary.cashCollectionRate)}
            tone="emerald"
          />
        )}
        {summary.debtGrowth !== undefined && (
          <Mini
            label="Прирост долга"
            value={money(summary.debtGrowth)}
            tone={summary.debtGrowth > 0 ? 'rose' : 'emerald'}
          />
        )}
        {summary.zeroCostShare !== undefined && summary.zeroCostShare > 0 && (
          <Mini
            label="Без себест-ти"
            value={pct(summary.zeroCostShare)}
            tone="amber"
          />
        )}
        {summary.openShiftsCount !== undefined && summary.openShiftsCount > 0 && (
          <Mini
            label="Открытых смен"
            value={summary.openShiftsCount}
            tone="amber"
          />
        )}
        <Mini label="Расходы" value={money(summary.expensesTotal)} tone="rose" />
      </div>

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

      <Card>
        <SectionTitle
          right={
            bars.length > 0 && (
              <ExportBtn
                name="timeseries"
                headers={['Период', 'Получено', 'Выставлено', 'Заказов']}
                rows={(tsr.data?.buckets ?? []).map((b) => [
                  b.label,
                  b.collected,
                  b.billed,
                  b.ordersCount,
                ])}
              />
            )
          }
        >
          Динамика выручки (получено деньгами)
        </SectionTitle>
        <ReportGate loading={tsr.loading} error={tsr.error} onRetry={tsr.reload}>
          {bars.length === 0 ? (
            <EmptyState icon="reports" title="Нет данных" />
          ) : (
            <BarChart data={bars} />
          )}
        </ReportGate>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  ВКЛАДКА: ПРОДАЖИ                                                   */
/* ================================================================== */

export function SalesSection({ f }: { f: Filters }) {
  const tsr = useReport<Timeseries>(
    () =>
      api.get<Timeseries>(
        `/reports/timeseries?${baseQuery(f, { groupBy: f.groupBy })}`,
      ),
    [f],
  );
  const clientsR = useReport<SalesByClient>(
    () =>
      api.get<SalesByClient>(
        `/reports/sales-by-client?${baseQuery(f, { limit: 50 })}`,
      ),
    [f],
  );

  // доп. фильтры реестра заказов
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [payment, setPayment] = useState('');

  const ordersR = useReport<OrdersRegistry>(
    () =>
      api.get<OrdersRegistry>(
        `/reports/orders?${baseQuery(f, {
          status: status || undefined,
          type: type || undefined,
          paymentStatus: payment || undefined,
          limit: 500,
        })}`,
      ),
    [f, status, type, payment],
  );

  const clients = clientsR.data;
  const orders = ordersR.data;
  const bars =
    tsr.data?.buckets.map((b) => ({
      label: b.label,
      value: b.billed,
      title: `${b.label}: выставлено ${money(b.billed)}`,
    })) ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>Выставлено по периодам</SectionTitle>
        <ReportGate loading={tsr.loading} error={tsr.error} onRetry={tsr.reload}>
          {bars.length === 0 ? (
            <EmptyState icon="reports" title="Нет данных" />
          ) : (
            <BarChart data={bars} color="bg-sky-500" hoverColor="group-hover:bg-sky-600" />
          )}
        </ReportGate>
      </Card>

      {/* Продажи по клиентам */}
      <Card>
        <SectionTitle
          right={
            clients && clients.items.length > 0 ? (
              <ExportBtn
                name="sales-by-client"
                headers={['Клиент', 'Телефон', 'Заказов', 'Выручка', 'Оплачено', 'Долг', 'Ср. чек']}
                rows={clients.items.map((c) => [
                  c.client,
                  c.phone,
                  c.orders,
                  c.revenue,
                  c.paid,
                  c.debt,
                  c.avgCheck,
                ])}
              />
            ) : undefined
          }
        >
          Продажи по клиентам
        </SectionTitle>
        <ReportGate
          loading={clientsR.loading}
          error={clientsR.error}
          onRetry={clientsR.reload}
        >
        {!clients || clients.items.length === 0 ? (
          <EmptyState icon="clients" title="Нет данных" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th className="text-right">Заказов</th>
                  <th className="text-right">Выручка</th>
                  <th className="text-right">Долг</th>
                  <th className="text-right">Доля</th>
                  <th className="text-right">Посл. заказ</th>
                </tr>
              </thead>
              <tbody>
                {clients.items.map((c, i) => (
                  <tr key={c.clientId ?? `x${i}`}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">
                      {c.client}
                      {c.phone && (
                        <span className="ml-2 text-xs text-slate-400">{c.phone}</span>
                      )}
                    </td>
                    <td className="text-right text-slate-500">{c.orders}</td>
                    <td className="text-right font-semibold text-slate-800 dark:text-slate-100">
                      {money(c.revenue)}
                    </td>
                    <td className="text-right text-rose-600">
                      {c.debt > 0 ? money(c.debt) : ''}
                    </td>
                    <td className="text-right text-slate-500">{pct(c.sharePct)}</td>
                    <td className="text-right text-slate-400">
                      {c.lastOrderDate ? fmtDate(c.lastOrderDate) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ReportGate>
      </Card>

      {/* Реестр заказов */}
      <Card>
        <SectionTitle
          right={
            orders && orders.items.length > 0 ? (
              <ExportBtn
                name="orders"
                headers={[
                  'Заказ', 'Дата', 'Клиент', 'Телефон', 'Тип', 'Статус',
                  'Оплата', 'Срочность', 'Филиал', 'Итого', 'Оплачено', 'Долг',
                ]}
                rows={orders.items.map((o) => [
                  o.orderNumber,
                  fmtDate(o.date),
                  o.client,
                  o.phone,
                  ORDER_TYPE_LABEL[o.type] ?? o.type,
                  ORDER_STATUS_LABEL[o.status] ?? o.status,
                  PAYMENT_STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus,
                  URGENCY_LABEL[o.urgency] ?? o.urgency,
                  o.branch,
                  o.total,
                  o.paid,
                  o.debt,
                ])}
              />
            ) : undefined
          }
        >
          Реестр заказов
        </SectionTitle>

        <div className="mb-3 flex flex-wrap gap-2 no-print">
          <Field>
            <Select value={type} onChange={(e) => setType(e.target.value)} className="w-40">
              <option value="">Все типы</option>
              {Object.entries(ORDER_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
              <option value="">Все статусы</option>
              {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field>
            <Select value={payment} onChange={(e) => setPayment(e.target.value)} className="w-40">
              <option value="">Любая оплата</option>
              {Object.entries(PAYMENT_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
        </div>

        <ReportGate
          loading={ordersR.loading}
          error={ordersR.error}
          onRetry={ordersR.reload}
        >
        {orders && (
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Mini label="Заказов" value={orders.count} tone="indigo" />
            <Mini label="Итого" value={money(orders.totals.total)} />
            <Mini label="Оплачено" value={money(orders.totals.paid)} tone="emerald" />
            <Mini label="Долг" value={money(orders.totals.debt)} tone="rose" />
          </div>
        )}

        {!orders || orders.items.length === 0 ? (
          <EmptyState icon="orders" title="Нет заказов" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Дата</th>
                  <th>Клиент</th>
                  <th>Тип</th>
                  <th>Статус</th>
                  <th>Оплата</th>
                  <th className="text-right">Итого</th>
                  <th className="text-right">Долг</th>
                </tr>
              </thead>
              <tbody>
                {orders.items.map((o) => (
                  <tr key={o.orderId}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">
                      №{o.orderNumber}
                    </td>
                    <td className="text-slate-500">{fmtDate(o.date)}</td>
                    <td className="text-slate-500">{o.client}</td>
                    <td className="text-slate-500">{ORDER_TYPE_LABEL[o.type] ?? o.type}</td>
                    <td>
                      <Badge tone={o.status === 'CANCELLED' ? 'rose' : 'slate'}>
                        {ORDER_STATUS_LABEL[o.status] ?? o.status}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={o.paymentStatus === 'PAID' ? 'emerald' : o.paymentStatus === 'DEBT' ? 'rose' : 'amber'}>
                        {PAYMENT_STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus}
                      </Badge>
                    </td>
                    <td className="text-right font-semibold text-slate-800 dark:text-slate-100">
                      {money(o.total)}
                    </td>
                    <td className="text-right text-rose-600">
                      {o.debt > 0 ? money(o.debt) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ReportGate>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  ВКЛАДКА: УСЛУГИ/ТОВАРЫ                                             */
/* ================================================================== */

export function ItemsSection({ f }: { f: Filters }) {
  const [type, setType] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const t = type === 'all' ? undefined : type;

  const itemsR = useReport<SalesItem[]>(
    () => api.get<SalesItem[]>(`/reports/sales-by-item?${baseQuery(f, { type: t })}`),
    [f, type],
  );
  const byCatR = useReport<SalesByCategory>(
    () =>
      api.get<SalesByCategory>(`/reports/sales-by-category?${baseQuery(f, { type: t })}`),
    [f, type],
  );
  const abcR = useReport<Abc>(
    () => api.get<Abc>(`/reports/abc?${baseQuery(f, { type: t })}`),
    [f, type],
  );

  const items = itemsR.data ?? [];
  const byCat = byCatR.data;
  const abc = abcR.data;

  const typeSeg = (
    <Segmented
      className="no-print"
      options={[
        { key: 'all', label: 'Все' },
        { key: 'SERVICE', label: 'Услуги' },
        { key: 'PRODUCT', label: 'Товары' },
      ]}
      active={type}
      onChange={setType}
    />
  );

  return (
    <div className="space-y-6">
      {/* Sales by item */}
      <Card>
        <SectionTitle
          right={
            <div className="flex items-center gap-2">
              {typeSeg}
              {items.length > 0 && (
                <ExportBtn
                  name="sales-by-item"
                  headers={['Наименование', 'Тип', 'Категория', 'Кол-во', 'Выручка', 'Себест-ть', 'Прибыль', 'Маржа', 'Доля']}
                  rows={items.map((s) => [
                    s.name,
                    s.type === 'SERVICE' ? 'Услуга' : 'Товар',
                    s.category,
                    s.qty,
                    s.revenue,
                    s.cost,
                    s.profit,
                    s.margin,
                    s.sharePct,
                  ])}
                />
              )}
            </div>
          }
        >
          Продажи по позициям
        </SectionTitle>
        <ReportGate loading={itemsR.loading} error={itemsR.error} onRetry={itemsR.reload}>
        {items.length === 0 ? (
          <EmptyState icon="services" title="Нет продаж за период" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Категория</th>
                  <th className="text-right">Кол-во</th>
                  <th className="text-right">Выручка</th>
                  <th className="text-right">Прибыль</th>
                  <th className="text-right">Маржа</th>
                  <th className="text-right">Доля</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.key}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">
                      {s.type === 'SERVICE' ? (
                        <Badge tone="violet" className="mr-2">У</Badge>
                      ) : (
                        <Badge tone="sky" className="mr-2">Т</Badge>
                      )}
                      {s.name}
                      {s.zeroCost && (
                        <Badge tone="amber" className="ml-2">без себест-ти</Badge>
                      )}
                    </td>
                    <td className="text-slate-500">{s.category}</td>
                    <td className="text-right text-slate-500">{num(s.qty)}</td>
                    <td className="text-right font-semibold text-slate-800 dark:text-slate-100">
                      {money(s.revenue)}
                    </td>
                    <td className="text-right text-emerald-600">{money(s.profit)}</td>
                    <td className="text-right text-slate-500">{pct(s.margin)}</td>
                    <td className="text-right text-slate-500">{pct(s.sharePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ReportGate>
      </Card>

      {/* Sales by category */}
      <Card>
        <SectionTitle
          right={
            byCat && byCat.items.length > 0 ? (
              <ExportBtn
                name="sales-by-category"
                headers={['Категория', 'Кол-во', 'Выручка', 'Прибыль', 'Маржа', 'Доля']}
                rows={byCat.items.flatMap((c: CategoryRow) => [
                  [c.category, c.qty, c.revenue, c.profit, c.margin, c.sharePct],
                  ...c.children.map((ch) => [
                    `  ${ch.category}`, ch.qty, ch.revenue, ch.profit, ch.margin, ch.sharePct,
                  ]),
                ])}
              />
            ) : undefined
          }
        >
          Продажи по категориям
        </SectionTitle>
        <ReportGate loading={byCatR.loading} error={byCatR.error} onRetry={byCatR.reload}>
        {!byCat || byCat.items.length === 0 ? (
          <EmptyState icon="services" title="Нет данных" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Категория</th>
                  <th className="text-right">Кол-во</th>
                  <th className="text-right">Выручка</th>
                  <th className="text-right">Прибыль</th>
                  <th className="text-right">Маржа</th>
                  <th className="text-right">Доля</th>
                </tr>
              </thead>
              <tbody>
                {byCat.items.map((c) => {
                  const key = c.categoryId ?? c.category;
                  const open = expanded[key];
                  const hasCh = c.children.length > 0;
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td className="font-medium text-slate-700 dark:text-slate-200">
                          {hasCh ? (
                            <button
                              className="mr-1 text-slate-400 hover:text-indigo-600 no-print"
                              onClick={() =>
                                setExpanded((e) => ({ ...e, [key]: !open }))
                              }
                            >
                              {open ? '▾' : '▸'}
                            </button>
                          ) : (
                            <span className="mr-1 inline-block w-3" />
                          )}
                          {c.category}
                        </td>
                        <td className="text-right text-slate-500">{num(c.qty)}</td>
                        <td className="text-right font-semibold text-slate-800 dark:text-slate-100">
                          {money(c.revenue)}
                        </td>
                        <td className="text-right text-emerald-600">{money(c.profit)}</td>
                        <td className="text-right text-slate-500">{pct(c.margin)}</td>
                        <td className="text-right text-slate-500">{pct(c.sharePct)}</td>
                      </tr>
                      {open &&
                        c.children.map((ch, i) => (
                          <tr key={`${key}-${ch.categoryId ?? i}`} className="bg-slate-50/60 dark:bg-slate-800/30">
                            <td className="pl-8 text-slate-500">{ch.category}</td>
                            <td className="text-right text-slate-400">{num(ch.qty)}</td>
                            <td className="text-right text-slate-600 dark:text-slate-300">{money(ch.revenue)}</td>
                            <td className="text-right text-emerald-600/80">{money(ch.profit)}</td>
                            <td className="text-right text-slate-400">{pct(ch.margin)}</td>
                            <td className="text-right text-slate-400">{pct(ch.sharePct)}</td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </ReportGate>
      </Card>

      {/* ABC */}
      <Card>
        <SectionTitle
          right={
            abc && abc.items.length > 0 ? (
              <ExportBtn
                name="abc"
                headers={['Наименование', 'Выручка', 'Доля', 'Накопл.', 'Класс']}
                rows={abc.items.map((a) => [a.name, a.revenue, a.sharePct, a.cumPct, a.class])}
              />
            ) : undefined
          }
        >
          ABC-анализ
        </SectionTitle>
        <ReportGate loading={abcR.loading} error={abcR.error} onRetry={abcR.reload}>
        {!abc || abc.items.length === 0 ? (
          <EmptyState icon="reports" title="Нет данных" />
        ) : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-3">
              {(['A', 'B', 'C'] as const).map((cl) => (
                <div key={cl} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                  <div className="text-xs text-slate-500">
                    Класс {cl} · {abc.summary[cl].count} поз.
                  </div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
                    {money(abc.summary[cl].revenue)}
                  </div>
                  <div className="text-xs text-slate-400">{pct(abc.summary[cl].sharePct)}</div>
                </div>
              ))}
            </div>
            <div className="pp-table-scroll">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Наименование</th>
                    <th className="text-right">Выручка</th>
                    <th className="text-right">Доля</th>
                    <th className="text-right">Накопл.</th>
                    <th className="text-center">Класс</th>
                  </tr>
                </thead>
                <tbody>
                  {abc.items.map((a) => (
                    <tr key={a.key}>
                      <td className="font-medium text-slate-700 dark:text-slate-200">{a.name}</td>
                      <td className="text-right text-slate-800 dark:text-slate-100">{money(a.revenue)}</td>
                      <td className="text-right text-slate-500">{pct(a.sharePct)}</td>
                      <td className="text-right text-slate-500">{pct(a.cumPct)}</td>
                      <td className="text-center">
                        <Badge tone={a.class === 'A' ? 'emerald' : a.class === 'B' ? 'amber' : 'slate'}>
                          {a.class}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        </ReportGate>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  ВКЛАДКА: ПРИБЫЛЬ                                                   */
/* ================================================================== */

export function ProfitSection({ f }: { f: Filters }) {
  const profitR = useReport<Profit>(
    () => api.get<Profit>(`/reports/profit?${baseQuery(f)}`),
    [f],
  );
  const profit = profitR.data;

  return (
    <Card>
      <SectionTitle
        right={
          profit && profit.items.length > 0 ? (
            <ExportBtn
              name="profit"
              headers={['Заказ', 'Дата', 'Клиент', 'Выручка', 'Себест-ть', 'Прибыль', 'Маржа']}
              rows={profit.items.map((p) => [
                p.orderNumber, fmtDate(p.date), p.client, p.revenue, p.cost, p.profit, p.margin,
              ])}
            />
          ) : undefined
        }
      >
        Прибыль по заказам
      </SectionTitle>

      <ReportGate loading={profitR.loading} error={profitR.error} onRetry={profitR.reload}>
      {profit && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Mini label="Выручка" value={money(profit.revenue)} />
          <Mini label="Себестоимость" value={money(profit.cost)} tone="amber" />
          <Mini label="Прибыль" value={money(profit.profit)} tone="emerald" />
          <Mini label="Маржа" value={pct(profit.margin)} tone="indigo" />
        </div>
      )}

      {!profit || profit.items.length === 0 ? (
        <EmptyState
          icon="reports"
          title="Нет данных"
          hint="Прибыль считается, если у услуг/товаров указана себестоимость."
        />
      ) : (
        <div className="pp-table-scroll">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Заказ</th>
                <th>Дата</th>
                <th>Клиент</th>
                <th className="text-right">Выручка</th>
                <th className="text-right">Себест-ть</th>
                <th className="text-right">Прибыль</th>
                <th className="text-right">Маржа</th>
              </tr>
            </thead>
            <tbody>
              {profit.items.slice(0, 200).map((p) => (
                <tr key={p.orderId} className={p.loss ? 'bg-rose-50/40 dark:bg-rose-500/5' : ''}>
                  <td className="font-medium text-slate-700 dark:text-slate-200">№{p.orderNumber}</td>
                  <td className="text-slate-400">{fmtDate(p.date)}</td>
                  <td className="text-slate-500">{p.client}</td>
                  <td className="text-right text-slate-600 dark:text-slate-300">{money(p.revenue)}</td>
                  <td className="text-right text-amber-600">{money(p.cost)}</td>
                  <td className={`text-right font-semibold ${p.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {money(p.profit)}
                  </td>
                  <td className="text-right text-slate-500">{pct(p.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </ReportGate>
    </Card>
  );
}

/* ================================================================== */
/*  ВКЛАДКА: ФИНАНСЫ (cashflow + expenses)                             */
/* ================================================================== */

export function FinanceSection({ f }: { f: Filters }) {
  const cfR = useReport<Cashflow>(
    () =>
      api.get<Cashflow>(`/reports/cashflow?${baseQuery(f, { groupBy: f.groupBy })}`),
    [f],
  );
  const expR = useReport<Expenses>(
    () => api.get<Expenses>(`/reports/expenses?${baseQuery(f)}`),
    [f],
  );
  const cf = cfR.data;
  const exp = expR.data;

  const bars =
    cf?.buckets.map((b) => ({
      label: b.label,
      value: b.net,
      title: `${b.label}: поток ${money(b.net)} (+${money(b.inflow)} / −${money(b.outflow)})`,
    })) ?? [];

  return (
    <div className="space-y-6">
      {cf && (
        <StatGrid cols={4}>
          <StatCard icon="cash" tone="emerald" label="Поступления" value={money(cf.inflow)} />
          <StatCard icon="purchasing" tone="rose" label="Выплаты" value={money(cf.outflow)} />
          <StatCard icon="reports" tone={cf.net >= 0 ? 'indigo' : 'rose'} label="Чистый поток" value={money(cf.net)} />
          {cf.refundsCash !== undefined && (
            <StatCard icon="alert" tone="amber" label="Возвраты (нал.)" value={money(cf.refundsCash)} />
          )}
        </StatGrid>
      )}

      <Card>
        <SectionTitle>Денежный поток по периодам</SectionTitle>
        <ReportGate loading={cfR.loading} error={cfR.error} onRetry={cfR.reload}>
          {bars.length === 0 ? (
            <EmptyState icon="cash" title="Нет данных" />
          ) : (
            <BarChart data={bars} color="bg-emerald-500" hoverColor="group-hover:bg-emerald-600" />
          )}
        </ReportGate>
      </Card>

      <Card>
        <SectionTitle
          right={
            exp && exp.byCategory.length > 0 ? (
              <ExportBtn
                name="expenses"
                headers={['Категория', 'Сумма', 'Кол-во', 'Доля']}
                rows={exp.byCategory.map((c) => [c.category, c.amount, c.count ?? '', c.sharePct ?? ''])}
              />
            ) : undefined
          }
        >
          Расходы по категориям · {exp ? money(exp.total) : '—'}
        </SectionTitle>
        <ReportGate loading={expR.loading} error={expR.error} onRetry={expR.reload}>
        {!exp || exp.byCategory.length === 0 ? (
          <EmptyState icon="cash" title="Расходов нет" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {exp.byCategory.map((c) => (
              <div
                key={c.category}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50"
              >
                <span className="text-slate-600 dark:text-slate-300">
                  {c.category}
                  {c.count !== undefined && (
                    <span className="ml-2 text-xs text-slate-400">×{c.count}</span>
                  )}
                </span>
                <span className="font-medium text-slate-800 dark:text-slate-100">{money(c.amount)}</span>
              </div>
            ))}
          </div>
        )}
        </ReportGate>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  ВКЛАДКА: ДОЛГИ (receivables + payables)                            */
/* ================================================================== */

export function DebtsSection({ f }: { f: Filters }) {
  const recR = useReport<Receivables>(
    () =>
      api.get<Receivables>(
        `/reports/receivables?${buildQuery({ companyId: f.cid, branchId: f.branchId || undefined })}`,
      ),
    [f],
  );
  const payR = useReport<Payables>(
    () =>
      api.get<Payables>(`/reports/payables?${buildQuery({ companyId: f.cid })}`),
    [f],
  );
  const rec = recR.data;
  const pay = payR.data;

  return (
    <div className="space-y-6">
      {/* Дебиторка */}
      <Card>
        <SectionTitle
          right={
            <div className="flex items-center gap-2">
              {rec && rec.items.length > 0 && (
                <ExportBtn
                  name="receivables"
                  headers={['Заказ', 'Клиент', 'Телефон', 'Итого', 'Оплачено', 'Долг', 'Срок', 'Просрочка (дн.)']}
                  rows={rec.items.map((r) => [
                    r.orderNumber, r.client, r.phone, r.total, r.paid, r.debt,
                    r.dueDate ? fmtDate(r.dueDate) : '', r.overdue ? r.daysOverdue : 0,
                  ])}
                />
              )}
              {rec && <span className="font-semibold text-rose-600">{money(rec.total)} · {rec.count}</span>}
            </div>
          }
        >
          Дебиторка (нам должны)
        </SectionTitle>

        <ReportGate loading={recR.loading} error={recR.error} onRetry={recR.reload}>
        {rec && (
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Mini label="Не просрочено" value={money(rec.aging.current)} tone="emerald" />
            <Mini label="1–30 дн." value={money(rec.aging.d1_30)} tone="amber" />
            <Mini label="31–60 дн." value={money(rec.aging.d31_60)} tone="rose" />
            <Mini label="60+ дн." value={money(rec.aging.d60plus)} tone="rose" />
          </div>
        )}

        {!rec || rec.items.length === 0 ? (
          <EmptyState icon="clients" title="Долгов нет" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Клиент</th>
                  <th className="text-right">Долг</th>
                  <th className="text-right">Срок</th>
                  <th className="text-right">Просрочка</th>
                </tr>
              </thead>
              <tbody>
                {rec.items.map((r) => (
                  <tr key={r.orderId} className={r.overdue ? 'bg-rose-50/40 dark:bg-rose-500/5' : ''}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">№{r.orderNumber}</td>
                    <td className="text-slate-500">
                      {r.client}
                      {r.phone && <span className="ml-2 text-xs text-slate-400">{r.phone}</span>}
                    </td>
                    <td className="text-right font-semibold text-rose-600">{money(r.debt)}</td>
                    <td className="text-right text-slate-400">{r.dueDate ? fmtDate(r.dueDate) : '—'}</td>
                    <td className="text-right text-slate-500">
                      {r.overdue ? <Badge tone="rose">{r.daysOverdue} дн.</Badge> : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ReportGate>
      </Card>

      {/* Кредиторка */}
      <Card>
        <SectionTitle
          right={
            <div className="flex items-center gap-2">
              {pay && pay.items.length > 0 && (
                <ExportBtn
                  name="payables"
                  headers={['Поставщик', 'Телефон', 'Долг', 'Срок', 'Просрочен']}
                  rows={pay.items.map((p) => [
                    p.supplier, p.phone, p.debt, p.dueDate ? fmtDate(p.dueDate) : '', p.overdue ? 'да' : 'нет',
                  ])}
                />
              )}
              {pay && <span className="font-semibold text-amber-600">{money(pay.total)} · {pay.count}</span>}
            </div>
          }
        >
          Кредиторка (мы должны)
        </SectionTitle>
        <ReportGate loading={payR.loading} error={payR.error} onRetry={payR.reload}>
        {!pay || pay.items.length === 0 ? (
          <EmptyState icon="purchasing" title="Долгов поставщикам нет" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Поставщик</th>
                  <th className="text-right">Долг</th>
                  <th className="text-right">Срок</th>
                  <th className="text-right">Статус</th>
                </tr>
              </thead>
              <tbody>
                {pay.items.map((p) => (
                  <tr key={p.supplierId} className={p.overdue ? 'bg-rose-50/40 dark:bg-rose-500/5' : ''}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">
                      {p.supplier}
                      {p.phone && <span className="ml-2 text-xs text-slate-400">{p.phone}</span>}
                    </td>
                    <td className="text-right font-semibold text-amber-600">{money(p.debt)}</td>
                    <td className="text-right text-slate-400">{p.dueDate ? fmtDate(p.dueDate) : '—'}</td>
                    <td className="text-right">
                      {p.overdue ? <Badge tone="rose">просрочен</Badge> : <Badge tone="slate">в срок</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ReportGate>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  ВКЛАДКА: СКЛАД (inventory + stock-movements)                      */
/* ================================================================== */

export function WarehouseSection({ f }: { f: Filters }) {
  const invR = useReport<Inventory>(
    () =>
      api.get<Inventory>(
        `/reports/inventory?${buildQuery({ companyId: f.cid, branchId: f.branchId || undefined })}`,
      ),
    [f],
  );
  const movR = useReport<StockMovements>(
    () => api.get<StockMovements>(`/reports/stock-movements?${baseQuery(f)}`),
    [f],
  );
  const inv = invR.data;
  const mov = movR.data;

  return (
    <div className="space-y-6">
      {inv && (
        <StatGrid cols={4}>
          <StatCard icon="warehouse" tone="indigo" label="Стоимость остатков" value={money(inv.totalValue)} />
          <StatCard icon="barcode" tone="slate" label="Позиций (SKU)" value={inv.totalSku} />
          <StatCard icon="warehouse" tone="sky" label="Всего единиц" value={num(inv.totalQty)} />
          <StatCard icon="alert" tone="rose" label="Дефицит" value={inv.lowStock.length} />
        </StatGrid>
      )}

      {/* Дефицит */}
      {inv && inv.lowStock.length > 0 && (
        <Card>
          <SectionTitle
            right={
              <ExportBtn
                name="low-stock"
                headers={['Товар', 'Остаток', 'Мин. остаток', 'Ед.']}
                rows={inv.lowStock.map((l) => [l.name, l.qty, l.minStock, l.unit])}
              />
            }
          >
            Заканчивается на складе
          </SectionTitle>
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="text-right">Остаток</th>
                  <th className="text-right">Минимум</th>
                </tr>
              </thead>
              <tbody>
                {inv.lowStock.map((l) => (
                  <tr key={l.productId}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{l.name}</td>
                    <td className="text-right font-semibold text-rose-600">{num(l.qty)} {l.unit}</td>
                    <td className="text-right text-slate-400">{num(l.minStock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Остатки */}
      <Card>
        <SectionTitle
          right={
            inv && inv.items.length > 0 ? (
              <ExportBtn
                name="inventory"
                headers={['Товар', 'Категория', 'Ед.', 'Кол-во', 'Себест-ть', 'Стоимость']}
                rows={inv.items.map((it) => [
                  it.name, it.category, it.unit, it.qty, it.purchasePrice, it.value,
                ])}
              />
            ) : undefined
          }
        >
          Остатки на складе
        </SectionTitle>
        <ReportGate loading={invR.loading} error={invR.error} onRetry={invR.reload}>
        {!inv || inv.items.length === 0 ? (
          <EmptyState icon="warehouse" title="Склад пуст" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Категория</th>
                  <th className="text-right">Кол-во</th>
                  <th className="text-right">Себест-ть</th>
                  <th className="text-right">Стоимость</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.slice(0, 300).map((it) => (
                  <tr key={it.productId}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{it.name}</td>
                    <td className="text-slate-500">{it.category}</td>
                    <td className="text-right text-slate-500">{num(it.qty)} {it.unit}</td>
                    <td className="text-right text-slate-500">{money(it.purchasePrice)}</td>
                    <td className="text-right font-semibold text-slate-800 dark:text-slate-100">{money(it.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ReportGate>
      </Card>

      {/* Списания */}
      <Card>
        <SectionTitle
          right={
            mov && mov.writeOffs.items.length > 0 ? (
              <ExportBtn
                name="write-offs"
                headers={['Дата', 'Товар', 'Кол-во', 'Себест-ть', 'Причина']}
                rows={mov.writeOffs.items.map((w) => [
                  fmtDate(w.date), w.product, w.qty, w.cost, w.reason,
                ])}
              />
            ) : undefined
          }
        >
          Списания · {mov ? money(mov.writeOffs.cost) : '—'}
        </SectionTitle>
        <ReportGate loading={movR.loading} error={movR.error} onRetry={movR.reload}>
          {!mov || mov.writeOffs.items.length === 0 ? (
            <EmptyState icon="warehouse" title="Списаний нет" />
          ) : (
            <div className="pp-table-scroll">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Товар</th>
                    <th className="text-right">Кол-во</th>
                    <th className="text-right">Себест-ть</th>
                    <th>Причина</th>
                  </tr>
                </thead>
                <tbody>
                  {mov.writeOffs.items.map((w, i) => (
                    <tr key={i}>
                      <td className="text-slate-400">{fmtDate(w.date)}</td>
                      <td className="font-medium text-slate-700 dark:text-slate-200">{w.product}</td>
                      <td className="text-right text-slate-500">{num(w.qty)}</td>
                      <td className="text-right text-amber-600">{money(w.cost)}</td>
                      <td className="text-slate-500">{w.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ReportGate>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  ВКЛАДКА: ЗАКУПКИ                                                   */
/* ================================================================== */

export function PurchasingSection({ f }: { f: Filters }) {
  const purR = useReport<Purchasing>(
    () => api.get<Purchasing>(`/reports/purchasing?${baseQuery(f)}`),
    [f],
  );
  const pur = purR.data;

  return (
    <div className="space-y-6">
      {pur && (
        <StatGrid cols={4}>
          <StatCard icon="purchasing" tone="indigo" label="Закуплено" value={money(pur.total)} />
          <StatCard icon="cash" tone="emerald" label="Оплачено" value={money(pur.paid)} />
          <StatCard icon="alert" tone="rose" label="Долг" value={money(pur.debt)} />
          <StatCard icon="quotes" tone="slate" label="Приёмок" value={pur.receiptsCount} />
        </StatGrid>
      )}

      <Card>
        <SectionTitle
          right={
            pur && pur.bySupplier.length > 0 ? (
              <ExportBtn
                name="purchasing-suppliers"
                headers={['Поставщик', 'Приёмок', 'Сумма', 'Оплачено', 'Долг']}
                rows={pur.bySupplier.map((s) => [s.supplier, s.receipts, s.total, s.paid, s.debt])}
              />
            ) : undefined
          }
        >
          По поставщикам
        </SectionTitle>
        <ReportGate loading={purR.loading} error={purR.error} onRetry={purR.reload}>
        {!pur || pur.bySupplier.length === 0 ? (
          <EmptyState icon="purchasing" title="Нет закупок за период" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Поставщик</th>
                  <th className="text-right">Приёмок</th>
                  <th className="text-right">Сумма</th>
                  <th className="text-right">Оплачено</th>
                  <th className="text-right">Долг</th>
                </tr>
              </thead>
              <tbody>
                {pur.bySupplier.map((s) => (
                  <tr key={s.supplierId}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{s.supplier}</td>
                    <td className="text-right text-slate-500">{s.receipts}</td>
                    <td className="text-right font-semibold text-slate-800 dark:text-slate-100">{money(s.total)}</td>
                    <td className="text-right text-emerald-600">{money(s.paid)}</td>
                    <td className="text-right text-rose-600">{s.debt > 0 ? money(s.debt) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ReportGate>
      </Card>

      <Card>
        <SectionTitle
          right={
            pur && pur.topProducts.length > 0 ? (
              <ExportBtn
                name="purchasing-products"
                headers={['Товар', 'Кол-во', 'Сумма']}
                rows={pur.topProducts.map((p) => [p.name, p.qty, p.amount])}
              />
            ) : undefined
          }
        >
          Топ закупаемых товаров
        </SectionTitle>
        <ReportGate loading={purR.loading} error={purR.error} onRetry={purR.reload}>
        {!pur || pur.topProducts.length === 0 ? (
          <EmptyState icon="warehouse" title="Нет данных" />
        ) : (
          <div className="pp-table-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="text-right">Кол-во</th>
                  <th className="text-right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {pur.topProducts.map((p) => (
                  <tr key={p.productId}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">{p.name}</td>
                    <td className="text-right text-slate-500">{num(p.qty)}</td>
                    <td className="text-right font-semibold text-slate-800 dark:text-slate-100">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </ReportGate>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  ВКЛАДКА: ПРОИЗВОДСТВО                                              */
/* ================================================================== */

export function ProductionSection({ f }: { f: Filters }) {
  const prodR = useReport<Production>(
    () => api.get<Production>(`/reports/production?${baseQuery(f)}`),
    [f],
  );
  const prod = prodR.data;

  return (
    <div className="space-y-6">
      {prod && (
        <StatGrid cols={4}>
          <StatCard icon="production" tone="indigo" label="Заданий" value={prod.jobsTotal} />
          <StatCard icon="check" tone="emerald" label="Завершено" value={prod.completed} />
          <StatCard icon="alert" tone="rose" label="Брак / переделки" value={`${prod.rework} · ${pct(prod.reworkRate)}`} />
          <StatCard icon="clock" tone="sky" label="Ср. цикл, ч" value={num(prod.avgLeadTimeHours)} />
        </StatGrid>
      )}

      {prod && (prod.onTimeRate !== undefined || prod.overdueInWork !== undefined || prod.unassignedJobs !== undefined) && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {prod.onTimeRate !== undefined && <Mini label="В срок" value={pct(prod.onTimeRate)} tone="emerald" />}
          {prod.overdueInWork !== undefined && <Mini label="Просрочены в работе" value={prod.overdueInWork} tone="rose" />}
          {prod.urgentInWork !== undefined && <Mini label="Срочные в работе" value={prod.urgentInWork} tone="amber" />}
          {prod.unassignedJobs !== undefined && <Mini label="Без исполнителя" value={prod.unassignedJobs} tone="amber" />}
        </div>
      )}

      <Card>
        <SectionTitle
          right={
            prod && prod.equipment.length > 0 ? (
              <ExportBtn
                name="equipment-load"
                headers={['Оборудование', 'Тип', 'В очереди', 'В работе', 'Готово', 'Брак']}
                rows={prod.equipment.map((e) => [e.name, e.type, e.inQueue, e.inWork, e.completed, e.rework])}
              />
            ) : undefined
          }
        >
          Загрузка оборудования
        </SectionTitle>
        <ReportGate loading={prodR.loading} error={prodR.error} onRetry={prodR.reload}>
        {!prod || prod.equipment.length === 0 ? (
          <EmptyState icon="equipment" title="Нет данных" />
        ) : (
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
                {prod.equipment.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium text-slate-700 dark:text-slate-200">
                      {e.name}
                      {e.status !== 'ACTIVE' && (
                        <Badge tone="amber" className="ml-2">
                          {e.status === 'REPAIR' ? 'ремонт' : 'выкл'}
                        </Badge>
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
        )}
        </ReportGate>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  ВКЛАДКА: СОТРУДНИКИ                                                */
/* ================================================================== */

export function StaffSection({ f }: { f: Filters }) {
  const staffR = useReport<StaffRow[]>(
    () => api.get<StaffRow[]>(`/reports/staff?${baseQuery(f)}`),
    [f],
  );
  const staff = staffR.data ?? [];

  return (
    <Card>
      <SectionTitle
        right={
          staff.length > 0 ? (
            <ExportBtn
              name="staff"
              headers={['Сотрудник', 'Роль', 'Заказов', 'Сумма продаж', 'Получено', 'Произв.', 'Задач']}
              rows={staff.map((u) => [
                u.name, u.role, u.ordersCreated, u.salesSum, u.collected ?? '', u.productionDone, u.tasksDone,
              ])}
            />
          ) : undefined
        }
      >
        Эффективность сотрудников
      </SectionTitle>
      <ReportGate loading={staffR.loading} error={staffR.error} onRetry={staffR.reload}>
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
                <th className="text-right">Продажи</th>
                <th className="text-right">Получено</th>
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
                  <td className="text-right text-emerald-600">{u.collected !== undefined ? money(u.collected) : '—'}</td>
                  <td className="text-right text-slate-500">{u.productionDone}</td>
                  <td className="text-right text-slate-500">{u.tasksDone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </ReportGate>
    </Card>
  );
}
