import { PaymentStatus } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Чистая денежная математика заказов — вынесена из orders.service, чтобы её можно
// было покрыть юнит-тестами (order-math.spec.ts). Сервис вызывает ЭТИ функции,
// поэтому тесты защищают реальную бизнес-логику от регрессий (деньги/возвраты).
// ─────────────────────────────────────────────────────────────────────────────

const round2 = (n: number) => Number(n.toFixed(2));

/**
 * Доля фактически уплаченного к валовой стоимости строк. Скидка/промо/бонус
 * уменьшают order.total, но unitPrice строк остаются валовыми — возврат считаем
 * от НЕТТО-цен (P0-1). Кламп в [0, 1]; при нулевом валовом итоге → 1.
 */
export function netRatio(orderTotal: number, grossSubtotal: number): number {
  if (grossSubtotal <= 0) return 1;
  return Math.min(1, orderTotal / grossSubtotal);
}

/** Нетто-сумма возвращаемой строки (round2). */
export function lineReturnAmount(
  qty: number,
  unitPrice: number,
  ratio: number,
): number {
  return round2(qty * unitPrice * ratio);
}

/**
 * Сколько выдать НАЛИЧНЫМИ: не больше остатка полученной наличности за вычетом
 * уже возвращённой кэшем — серия «частичный + отмена» не должна выдать больше,
 * чем реально получено кэшем (P0-2).
 */
export function cashRefundCap(
  moneyBack: number,
  cashPaid: number,
  alreadyCashRefunded: number,
): number {
  const remaining = Math.max(0, cashPaid - alreadyCashRefunded);
  return round2(Math.min(moneyBack, remaining));
}

/**
 * Эффективный остаток к оплате с учётом возвратов (P0-3): после частичного
 * возврата к оплате остаётся меньше, иначе разрешалась бы переплата и заказ
 * не дошёл бы до PAID.
 */
export function effectiveTotal(total: number, returnedTotal: number): number {
  return round2(total - returnedTotal);
}

/** Статус оплаты по внесённой сумме и остатку. */
export function paymentStatusFor(
  newPaid: number,
  balanceDue: number,
): PaymentStatus {
  if (balanceDue <= 0) return PaymentStatus.PAID;
  if (newPaid > 0) return PaymentStatus.PARTIAL;
  return PaymentStatus.UNPAID;
}
