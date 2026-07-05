import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Записать действие (никогда не роняем основной запрос)
  async record(entry: {
    companyId?: string;
    userId?: string;
    action: string;
    entity?: string;
    entityId?: string;
    data?: unknown;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          companyId: entry.companyId,
          userId: entry.userId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          data: entry.data as object | undefined,
        },
      });
    } catch {
      // лог не должен ломать бизнес-операцию
    }
  }

  // Запись аудита ВНУТРИ переданной транзакции (P1-9d). В отличие от record(),
  // ошибку НЕ глушим: если аудит не записался — вся бизнес-операция откатывается
  // (гарантия «нет движения денег/склада/прав без следа»). before/after — снимок
  // ТОЛЬКО критичных полей; Decimal приводить к number/string на стороне вызова.
  async recordTx(
    tx: Prisma.TransactionClient,
    entry: {
      companyId?: string;
      userId?: string;
      action: string;
      entity?: string;
      entityId?: string;
      before?: unknown;
      after?: unknown;
      data?: Record<string, unknown>;
    },
  ) {
    await tx.auditLog.create({
      data: {
        companyId: entry.companyId,
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        data: {
          ...(entry.data ?? {}),
          before: (entry.before ?? null) as Prisma.InputJsonValue,
          after: (entry.after ?? null) as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async list(companyId: string, page = 1, pageSize = 50) {
    const where = { companyId };
    const take = Math.min(Math.max(pageSize, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Подтянем имена пользователей
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        user: r.userId ? nameById.get(r.userId) ?? '—' : 'система',
        createdAt: r.createdAt,
      })),
      total,
      page: Math.max(page, 1),
      pageSize: take,
    };
  }
}
