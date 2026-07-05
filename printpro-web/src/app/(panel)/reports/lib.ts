// Чистые хелперы и типы для страницы отчётов PrintPro.
// Никакой логики React здесь нет — только форматирование, построение
// query-строк, пресеты периодов и типы ответов API (по контракту /reports/*).

/* ------------------------------------------------------------------ */
/*  Форматирование                                                    */
/* ------------------------------------------------------------------ */

/** Деньги: «12 345 c.» (округление до целого, пробел как разделитель тысяч). */
export function money(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' c.';
}

/** Проценты: «12.3%» (1 знак после запятой). */
export function pct(n: number | null | undefined): string {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return (Math.round(v * 10) / 10).toString().replace('.', ',') + '%';
}

/** Число с разделителем тысяч (кол-во и т.п.). */
export function num(n: number | null | undefined): string {
  const v = Number(n) || 0;
  // до 2 знаков, лишние нули убираем
  const r = Math.round(v * 100) / 100;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(r);
}

/** Дата ISO → «02.07.2026». */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/* ------------------------------------------------------------------ */
/*  Выгрузка CSV (Excel: разделитель «;» + BOM для кириллицы)          */
/* ------------------------------------------------------------------ */

export function downloadCSV(
  headers: string[],
  rows: (string | number)[][],
  name: string,
): void {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  // BOM (﻿) — чтобы Excel правильно показал кириллицу
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.csv') ? name : `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Query-строка                                                      */
/* ------------------------------------------------------------------ */

export type QueryParams = Record<
  string,
  string | number | boolean | null | undefined
>;

/** Собирает query-строку, пропуская пустые значения. */
export function buildQuery(params: QueryParams): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

/* ------------------------------------------------------------------ */
/*  Пресеты периода                                                   */
/* ------------------------------------------------------------------ */

export type PeriodPreset =
  | 'today'
  | 'week'
  | 'month'
  | 'prevMonth'
  | 'days30'
  | 'year'
  | 'custom';

export const PERIOD_OPTIONS: { key: PeriodPreset; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: '7 дней' },
  { key: 'month', label: 'Этот месяц' },
  { key: 'prevMonth', label: 'Прошлый месяц' },
  { key: 'days30', label: '30 дней' },
  { key: 'year', label: 'Этот год' },
  { key: 'custom', label: 'Произвольный' },
];

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/**
 * Возвращает границы периода как ISO-строки (включительно).
 * Для «custom» используются переданные from/to (значения из <input type=date>,
 * формат YYYY-MM-DD) — они разворачиваются в 00:00:00.000 / 23:59:59.999.
 */
export function periodRange(
  preset: PeriodPreset,
  customFrom?: string,
  customTo?: string,
): { from: string; to: string } {
  const now = new Date();

  if (preset === 'custom') {
    const f = customFrom ? startOfDay(new Date(customFrom)) : startOfDay(now);
    const t = customTo ? endOfDay(new Date(customTo)) : endOfDay(now);
    return { from: f.toISOString(), to: t.toISOString() };
  }

  let from = new Date(now);
  let to = new Date(now);

  switch (preset) {
    case 'today':
      from = startOfDay(now);
      to = endOfDay(now);
      break;
    case 'week':
      from = startOfDay(now);
      from.setDate(from.getDate() - 6);
      to = endOfDay(now);
      break;
    case 'days30':
      from = startOfDay(now);
      from.setDate(from.getDate() - 29);
      to = endOfDay(now);
      break;
    case 'month':
      from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      to = endOfDay(now);
      break;
    case 'prevMonth': {
      from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      // последний день предыдущего месяца
      to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      break;
    }
    case 'year':
      from = startOfDay(new Date(now.getFullYear(), 0, 1));
      to = endOfDay(now);
      break;
  }

  return { from: from.toISOString(), to: to.toISOString() };
}

/** ISO → значение для <input type="date"> (YYYY-MM-DD, локальная дата). */
export function isoToDateInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------ */
/*  Типы ответов API (по контракту /reports/*)                        */
/* ------------------------------------------------------------------ */

export interface Branch {
  id: string;
  name: string;
}

export interface ByMethod {
  cash: number;
  card: number;
  qr: number;
  transfer: number;
  debt: number;
}

export interface CompareDeltas {
  collectedPct: number;
  billedPct: number;
  netPct: number;
  grossProfitPct: number;
  ordersCountPct: number;
  avgCheckPct: number;
}
export interface SummaryCompare {
  collected: number;
  billed: number;
  net: number;
  grossProfit: number;
  ordersCount: number;
  avgCheck: number;
  deltas: CompareDeltas;
}

export interface Summary {
  from: string;
  to: string;
  ordersCount: number;
  billed: number;
  returns: number;
  net: number;
  collected: number;
  debt: number;
  avgCheck: number;
  expensesTotal: number;
  grossProfit: number;
  margin: number;
  newClients: number;
  byMethod: ByMethod;
  // доп. поля (могут отсутствовать у старого бэкенда)
  cashCollectionRate?: number;
  debtGrowth?: number;
  zeroCostShare?: number;
  openShiftsCount?: number;
  compare?: SummaryCompare;
}

export interface TimeBucket {
  date: string;
  label: string;
  collected: number;
  billed: number;
  ordersCount: number;
  profit?: number;
  debt?: number;
  avgCheck?: number;
  cumCollected?: number;
}
export interface Timeseries {
  groupBy: string;
  buckets: TimeBucket[];
}

export interface SalesItem {
  key: string;
  name: string;
  type: 'SERVICE' | 'PRODUCT';
  category: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  sharePct: number;
  orders?: number;
  avgPrice?: number;
  avgCost?: number;
  zeroCost?: boolean;
}

export interface CategoryChild {
  categoryId: string | null;
  category: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  sharePct: number;
}
export interface CategoryRow extends CategoryChild {
  type?: string;
  children: CategoryChild[];
}
export interface SalesByCategory {
  total: number;
  items: CategoryRow[];
}

export interface ClientRow {
  clientId: string | null;
  client: string;
  phone: string;
  orders: number;
  revenue: number;
  paid: number;
  debt: number;
  avgCheck: number;
  sharePct: number;
  lastOrderDate?: string | null;
  daysSinceLastOrder?: number | null;
  overdueDebt?: number;
}
export interface SalesByClient {
  total: number;
  items: ClientRow[];
}

export interface AbcItem {
  key: string;
  name: string;
  type: string;
  revenue: number;
  sharePct: number;
  cumPct: number;
  class: 'A' | 'B' | 'C';
  profit?: number;
  profitClass?: 'A' | 'B' | 'C';
}
export interface AbcSummaryClass {
  count: number;
  revenue: number;
  sharePct: number;
}
export interface Abc {
  items: AbcItem[];
  summary: { A: AbcSummaryClass; B: AbcSummaryClass; C: AbcSummaryClass };
}

export interface ProfitItem {
  orderId: string;
  orderNumber: string;
  date: string;
  client: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  loss?: boolean;
}
export interface Profit {
  from: string;
  to: string;
  ordersCount: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  totalReturns?: number;
  zeroCostShare?: number;
  items: ProfitItem[];
}

export interface ExpenseCat {
  category: string;
  amount: number;
  count?: number;
  sharePct?: number;
}
export interface ExpenseItem {
  date: string;
  category: string;
  reason: string;
  amount: number;
}
export interface Expenses {
  from: string;
  to: string;
  total: number;
  byCategory: ExpenseCat[];
  items: ExpenseItem[];
}

export interface CashBucket {
  date: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  cumNet?: number;
}
export interface Cashflow {
  from: string;
  to: string;
  inflow: number;
  outflow: number;
  net: number;
  byMethod: { cash: number; card: number; qr: number; transfer: number };
  outByCategory: ExpenseCat[];
  buckets: CashBucket[];
  supplierPayments?: number;
  refundsCash?: number;
  openingBalance?: number;
  closingBalance?: number;
  expectedClosing?: number;
  discrepancy?: number;
  openShiftsCount?: number;
}

export interface Aging {
  current: number;
  d1_30: number;
  d31_60: number;
  d60plus: number;
}
export interface ReceivableItem {
  orderId: string;
  orderNumber: string;
  client: string;
  phone: string;
  total: number;
  paid: number;
  debt: number;
  dueDate: string | null;
  overdue: boolean;
  daysOverdue: number;
}
export interface Receivables {
  total: number;
  count: number;
  aging: Aging;
  items: ReceivableItem[];
  overdueTotal?: number;
  avgDaysOverdue?: number;
  topDebtors?: ReceivableItem[];
  badDebtEstimate?: number;
}

export interface PayableItem {
  supplierId: string;
  supplier: string;
  phone: string;
  debt: number;
  dueDate: string | null;
  overdue: boolean;
  paidAmount?: number;
}
export interface Payables {
  total: number;
  count: number;
  items: PayableItem[];
  aging?: Aging;
  overdueTotal?: number;
}

export interface PurchasingSupplier {
  supplierId: string;
  supplier: string;
  receipts: number;
  total: number;
  paid: number;
  debt: number;
}
export interface PurchasingProduct {
  productId: string;
  name: string;
  qty: number;
  amount: number;
  avgCost?: number;
  lastReceiptDate?: string | null;
  priceTrendPct?: number | null;
}
export interface Purchasing {
  total: number;
  paid: number;
  debt: number;
  receiptsCount: number;
  bySupplier: PurchasingSupplier[];
  topProducts: PurchasingProduct[];
  avgReceipt?: number;
  byStatus?: { paid: number; partial: number; debt: number };
}

export interface InventoryItem {
  productId: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  purchasePrice: number;
  value: number;
  daysOfCover?: number | null;
}
export interface LowStockItem {
  productId: string;
  name: string;
  qty: number;
  minStock: number;
  unit: string;
}
export interface Inventory {
  totalValue: number;
  totalSku: number;
  totalQty: number;
  lowStock: LowStockItem[];
  items: InventoryItem[];
  potentialProfit?: number;
  outOfStock?: LowStockItem[];
  negativeStock?: LowStockItem[];
}

export interface MoveTypeRow {
  type: string;
  count: number;
  qty: number;
}
export interface WriteOffItem {
  date: string;
  product: string;
  qty: number;
  cost: number;
  reason: string;
}
export interface MoveItem {
  date: string;
  product: string;
  type: string;
  qty: number;
  before: number | null;
  after: number | null;
  reason: string;
}
export interface StockMovements {
  byType: MoveTypeRow[];
  writeOffs: { total: number; cost: number; items: WriteOffItem[] };
  items: MoveItem[];
}

export interface EquipmentRow {
  id: string;
  name: string;
  type: string;
  status: string;
  inQueue: number;
  inWork: number;
  active?: number;
  completed: number;
  rework: number;
  total: number;
  reworkRate?: number;
  utilizationPct?: number;
}
export interface StatusRow {
  status: string;
  count: number;
}
export interface Production {
  jobsTotal: number;
  completed: number;
  rework: number;
  reworkRate: number;
  avgLeadTimeHours: number;
  byStatus: StatusRow[];
  equipment: EquipmentRow[];
  onTimeRate?: number;
  overdueInWork?: number;
  urgentInWork?: number;
  unassignedJobs?: number;
  throughput?: number;
}

export interface StaffRow {
  id: string;
  name: string;
  role: string;
  ordersCreated: number;
  salesSum: number;
  productionDone: number;
  tasksDone: number;
  collected?: number;
  avgCheck?: number;
  marginSum?: number;
  personalReworkRate?: number;
  avgLeadTimeHours?: number;
  activeJobsNow?: number;
}

export interface OrderRow {
  orderId: string;
  orderNumber: string;
  date: string;
  client: string;
  phone: string;
  type: string;
  status: string;
  paymentStatus: string;
  urgency: string;
  branch: string;
  total: number;
  paid: number;
  debt: number;
  deadline?: string | null;
  overdue?: boolean;
  daysToDeadline?: number | null;
  returned?: number;
}
export interface OrdersRegistry {
  count: number;
  totals: { total: number; paid: number; debt: number; returned?: number };
  items: OrderRow[];
}

export interface DailyPoint {
  date: string;
  amount: number;
}

/* ------------------------------------------------------------------ */
/*  Словари для отображения статусов/типов заказов                    */
/* ------------------------------------------------------------------ */

export const ORDER_TYPE_LABEL: Record<string, string> = {
  SALE: 'Продажа',
  PRINT: 'Печать',
  REPAIR: 'Ремонт',
  RECOVERY: 'Восстановление',
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  ACCEPTED: 'Принят',
  AWAITING_DESIGN: 'Ждёт дизайн',
  IN_DESIGN: 'В дизайне',
  DESIGN_APPROVAL: 'Согл. дизайна',
  DESIGN_APPROVED: 'Дизайн утв.',
  IN_PROGRESS: 'В работе',
  READY: 'Готов',
  DELIVERED: 'Выдан',
  REWORK: 'Переделка',
  CANCELLED: 'Отменён',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  UNPAID: 'Не оплачен',
  PARTIAL: 'Частично',
  PAID: 'Оплачен',
  DEBT: 'Долг',
};

export const URGENCY_LABEL: Record<string, string> = {
  NORMAL: 'Обычный',
  URGENT: 'Срочный',
  EXPRESS: 'Экспресс',
};
