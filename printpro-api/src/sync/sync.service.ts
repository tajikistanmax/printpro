import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Реестр синхронизируемых таблиц. Порядок важен: родители раньше детей
// (из-за внешних ключей). Этап 2 — полный охват.
const SYNC_TABLES: { model: string; table: string }[] = [
  { model: 'company', table: 'Company' },
  { model: 'branch', table: 'Branch' },
  { model: 'permission', table: 'Permission' },
  { model: 'role', table: 'Role' },
  { model: 'rolePermission', table: 'RolePermission' },
  { model: 'user', table: 'User' },
  { model: 'client', table: 'Client' },
  { model: 'clientFile', table: 'ClientFile' },
  { model: 'serviceCategory', table: 'ServiceCategory' },
  { model: 'service', table: 'Service' },
  { model: 'servicePriceTier', table: 'ServicePriceTier' },
  { model: 'serviceSize', table: 'ServiceSize' },
  { model: 'serviceOption', table: 'ServiceOption' },
  { model: 'productCategory', table: 'ProductCategory' },
  { model: 'unit', table: 'Unit' },
  { model: 'product', table: 'Product' },
  { model: 'serviceMaterial', table: 'ServiceMaterial' },
  { model: 'supplier', table: 'Supplier' },
  { model: 'stock', table: 'Stock' },
  { model: 'stockReceipt', table: 'StockReceipt' },
  { model: 'stockReceiptItem', table: 'StockReceiptItem' },
  { model: 'order', table: 'Order' },
  { model: 'orderItem', table: 'OrderItem' },
  { model: 'orderStatusHistory', table: 'OrderStatusHistory' },
  { model: 'orderRepairDetail', table: 'OrderRepairDetail' },
  { model: 'orderRecoveryDetail', table: 'OrderRecoveryDetail' },
  { model: 'orderFile', table: 'OrderFile' },
  { model: 'quote', table: 'Quote' },
  { model: 'quoteItem', table: 'QuoteItem' },
  { model: 'promoCode', table: 'PromoCode' },
  { model: 'cashShift', table: 'CashShift' },
  { model: 'payment', table: 'Payment' },
  { model: 'cashMovement', table: 'CashMovement' },
  { model: 'clientDebt', table: 'ClientDebt' },
  { model: 'stockMovement', table: 'StockMovement' },
  { model: 'task', table: 'Task' },
  { model: 'equipment', table: 'Equipment' },
  { model: 'productionJob', table: 'ProductionJob' },
  { model: 'designProof', table: 'DesignProof' },
  { model: 'setting', table: 'Setting' },
  { model: 'workTimeRecord', table: 'WorkTimeRecord' },
  { model: 'payrollPeriod', table: 'PayrollPeriod' },
  { model: 'salaryAdvance', table: 'SalaryAdvance' },
  { model: 'salaryRecord', table: 'SalaryRecord' },
];

@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');

  constructor(private readonly prisma: PrismaService) {}

  // Отдать все изменения после метки времени `since`
  async pull(since?: string) {
    const from = since ? new Date(since) : new Date(0);
    const until = new Date().toISOString();
    const changes: Record<string, unknown[]> = {};

    for (const t of SYNC_TABLES) {
      changes[t.model] = await (this.prisma as any)[t.model].findMany({
        where: { updatedAt: { gt: from } },
        orderBy: { updatedAt: 'asc' },
      });
    }
    return { until, changes };
  }

  // Принять пачку изменений от другого узла (last-write-wins)
  async push(changes: Record<string, any[]>, peer = 'peer') {
    let applied = 0;
    let skipped = 0;
    let failed = 0;

    for (const t of SYNC_TABLES) {
      const rows = changes?.[t.model] ?? [];
      for (const row of rows) {
        try {
          const incomingTs = new Date(row.updatedAt).getTime();
          const existing = await (this.prisma as any)[t.model].findUnique({
            where: { id: row.id },
          });
          // Конфликт: у нас версия не старее — пропускаем
          if (existing && new Date(existing.updatedAt).getTime() >= incomingTs) {
            skipped++;
            continue;
          }

          // updatedAt управляется @updatedAt — задаём его отдельно (raw)
          const data = { ...row };
          delete data.updatedAt;

          await (this.prisma as any)[t.model].upsert({
            where: { id: row.id },
            create: data,
            update: data,
          });

          // Сохраняем исходную метку времени и источник, чтобы не было эха
          await this.prisma.$executeRawUnsafe(
            `UPDATE "${t.table}" SET "updatedAt" = $1, "syncNode" = $2 WHERE id = $3`,
            new Date(row.updatedAt),
            row.syncNode ?? peer,
            row.id,
          );
          applied++;
        } catch (e) {
          failed++;
          this.logger.warn(`Не применилась запись ${t.model}/${row?.id}: ${e}`);
        }
      }
    }

    return { applied, skipped, failed };
  }

  // Синхронизатор отмечается после успешного цикла
  async heartbeat() {
    await this.prisma.syncCursor.upsert({
      where: { peer: 'heartbeat' },
      create: { peer: 'heartbeat' },
      update: { lastPullAt: new Date() },
    });
    return { ok: true };
  }

  // Статус для панели: когда была последняя синхронизация
  async status() {
    const hb = await this.prisma.syncCursor.findUnique({
      where: { peer: 'heartbeat' },
    });
    return {
      now: new Date().toISOString(),
      lastSyncAt: hb ? hb.lastPullAt.toISOString() : null,
      node: (process.env.NODE_ID ?? 'C').toUpperCase(),
    };
  }
}
