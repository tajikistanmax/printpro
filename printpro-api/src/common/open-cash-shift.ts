import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Находит открытую смену кассира и блокирует её строку до конца транзакции.
 *
 * Блокировка обязательна для денежных операций: одной проверки closedAt=null
 * недостаточно — параллельное закрытие смены могло закоммититься между чтением
 * смены и созданием Payment/CashMovement. FOR UPDATE сериализует эти операции:
 * либо деньги попадут в Z-отчёт до закрытия, либо операция увидит закрытую смену
 * и будет отклонена.
 */
export async function lockOpenCashShift(
  tx: Prisma.TransactionClient,
  companyId: string,
  userId?: string,
  requestedShiftId?: string,
): Promise<string> {
  if (!userId) {
    throw new BadRequestException('Нет открытой смены — сначала откройте кассу');
  }

  const rows = requestedShiftId
    ? await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM "CashShift"
        WHERE id = ${requestedShiftId}
          AND "companyId" = ${companyId}
          AND "userId" = ${userId}
          AND "closedAt" IS NULL
          AND "deletedAt" IS NULL
        FOR UPDATE
      `
    : await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM "CashShift"
        WHERE "companyId" = ${companyId}
          AND "userId" = ${userId}
          AND "closedAt" IS NULL
          AND "deletedAt" IS NULL
        ORDER BY "openedAt" DESC
        LIMIT 1
        FOR UPDATE
      `;

  const shiftId = rows[0]?.id;
  if (!shiftId) {
    throw new BadRequestException('Нет открытой смены — сначала откройте кассу');
  }
  return shiftId;
}
