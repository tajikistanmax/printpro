import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'crypto';
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
  { model: 'productBarcodeAlias', table: 'ProductBarcodeAlias' },
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
  { model: 'complaint', table: 'Complaint' },
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

const SENSITIVE_SYNC_MODELS = new Set([
  'company',
  'permission',
  'role',
  'rolePermission',
  'user',
  'cashShift',
  'payment',
  'cashMovement',
  'clientDebt',
  'workTimeRecord',
  'payrollPeriod',
  'salaryAdvance',
  'salaryRecord',
]);

const includeSensitiveSync = () => process.env.SYNC_INCLUDE_SENSITIVE === '1';

@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');

  constructor(private readonly prisma: PrismaService) {}

  // Отдать все изменения после метки времени `since`
  async pull(since?: string, peer?: string) {
    const from = since ? new Date(since) : new Date(0);
    const until = new Date().toISOString();
    const changes: Record<string, unknown[]> = {};

    for (const t of SYNC_TABLES) {
      if (SENSITIVE_SYNC_MODELS.has(t.model) && !includeSensitiveSync()) {
        changes[t.model] = [];
        continue;
      }
      changes[t.model] = await (this.prisma as any)[t.model].findMany({
        where: { updatedAt: { gt: from } },
        orderBy: { updatedAt: 'asc' },
      });
    }
    // Аудит: кто выгрузил данные и в каком объёме (peer identity)
    const exported = Object.values(changes).reduce((s, a) => s + a.length, 0);
    this.logger.log(
      `sync pull: peer=${peer ?? 'local'} since=${from.toISOString()} rows=${exported} sensitive=${includeSensitiveSync() ? 'on' : 'off'}`,
    );
    return { until, changes };
  }

  // Принять пачку изменений от другого узла (last-write-wins)
  async push(changes: Record<string, any[]>, peer = 'peer') {
    let applied = 0;
    let skipped = 0;
    let failed = 0;
    // Аудит: сколько записей по каждой модели изменил этот peer
    const mutatedByModel: Record<string, number> = {};

    for (const t of SYNC_TABLES) {
      const rows = changes?.[t.model] ?? [];
      if (SENSITIVE_SYNC_MODELS.has(t.model) && !includeSensitiveSync()) {
        skipped += rows.length;
        continue;
      }
      for (const row of rows) {
        try {
          if (!row?.id || !row?.updatedAt) {
            skipped++;
            continue;
          }
          const incomingTs = new Date(row.updatedAt).getTime();
          if (!Number.isFinite(incomingTs)) {
            skipped++;
            continue;
          }
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

          // Upsert данных и сброс updatedAt/syncNode — в ОДНОЙ транзакции (M-147).
          // Иначе окно краха между upsert и raw-UPDATE оставит строку с
          // @updatedAt = now() и syncNode = null: следующий pull примет её за
          // локальное изменение и отправит эхом обратно в облако (а также сдвиг
          // TS назад мог бы «омолодить» строку). Транзакция гарантирует, что
          // либо применились оба шага, либо ни одного.
          await this.prisma.$transaction(async (tx) => {
            await (tx as any)[t.model].upsert({
              where: { id: row.id },
              create: data,
              update: data,
            });

            // Сохраняем исходную метку времени и источник, чтобы не было эха
            await tx.$executeRawUnsafe(
              `UPDATE "${t.table}" SET "updatedAt" = $1, "syncNode" = $2 WHERE id = $3`,
              new Date(row.updatedAt),
              row.syncNode ?? peer,
              row.id,
            );
          });
          applied++;
          mutatedByModel[t.model] = (mutatedByModel[t.model] ?? 0) + 1;
        } catch (e) {
          failed++;
          this.logger.warn(
            `Не применилась запись ${t.model}/${row?.id} (peer=${peer}): ${e}`,
          );
        }
      }
    }

    // Аудит sync-мутаций с идентификацией peer'а
    const mutatedSummary = Object.entries(mutatedByModel)
      .map(([m, n]) => `${m}:${n}`)
      .join(',');
    this.logger.log(
      `sync push: peer=${peer} applied=${applied} skipped=${skipped} failed=${failed}${mutatedSummary ? ` [${mutatedSummary}]` : ''}`,
    );

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
      cloudConfigured: !!process.env.CLOUD_API,
      secretConfigured: !!process.env.SYNC_SECRET,
      cloudApi: process.env.CLOUD_API ?? null,
    };
  }

  // Ручная синхронизация «сейчас» — локальный API сам сходит в облако.
  // Один полный цикл: облако→локал и локал→облако. Курсоры — в SyncCursor.
  async runNow() {
    const CLOUD = process.env.CLOUD_API;
    const SECRET = process.env.SYNC_SECRET;
    const NODE_ID = (process.env.NODE_ID ?? 'K1').toUpperCase();
    const NODE_SECRET = process.env.SYNC_NODE_SECRET;
    if (!CLOUD || !SECRET) {
      throw new BadRequestException(
        'Синхронизация не настроена: задайте CLOUD_API и SYNC_SECRET в .env локального сервера',
      );
    }

    const getCursor = async (peer: string) => {
      const c = await this.prisma.syncCursor.findUnique({ where: { peer } });
      return c ? c.lastPullAt.toISOString() : new Date(0).toISOString();
    };
    const setCursor = async (peer: string, ts: string) => {
      await this.prisma.syncCursor.upsert({
        where: { peer },
        create: { peer, lastPullAt: new Date(ts) },
        update: { lastPullAt: new Date(ts) },
      });
    };
    const callCloud = async (path: string, body: unknown) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-sync-secret': SECRET,
      };
      if (NODE_SECRET) {
        const ts = String(Date.now());
        const nonce = randomUUID();
        // Подпись привязана к телу и одноразовому nonce (P0-5). Сервер хэширует
        // JSON.stringify(body) распарсенного тела — для наших payload (ключи —
        // имена таблиц/строки) порядок сохраняется при round-trip.
        const bodyHash = createHash('sha256')
          .update(JSON.stringify(body ?? {}))
          .digest('hex');
        headers['x-sync-node'] = NODE_ID;
        headers['x-sync-timestamp'] = ts;
        headers['x-sync-nonce'] = nonce;
        headers['x-sync-signature'] = createHmac('sha256', NODE_SECRET)
          .update(`${NODE_ID}.${ts}.${nonce}.${bodyHash}`)
          .digest('hex');
      }
      const res = await fetch(`${CLOUD}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`облако ${path} → ${res.status}`);
      return res.json();
    };
    const count = (changes: Record<string, unknown[]>) =>
      Object.values(changes ?? {}).reduce((s, a) => s + a.length, 0);

    let up = 0;
    let down = 0;
    // Курсор двигаем с overlap-окном (−5 мин): строки долгих/конкурентных
    // транзакций получают updatedAt в момент statement'а, ДО коммита, и wall-clock
    // `until` мог исключить их навсегда (`gt: until`). Перекрытие + идемпотентный
    // upsert в push ловят такие строки на следующем цикле (P0-14). Окно должно
    // покрывать самую долгую транзакцию (инвентаризация — до 2 мин).
    const OVERLAP_MS = 5 * 60 * 1000;
    const cursorFrom = (until: string) =>
      new Date(new Date(until).getTime() - OVERLAP_MS).toISOString();
    try {
      // 1) Облако → Локал
      const cloudSince = await getCursor('cloudPull');
      const fromCloud = await callCloud('/sync/pull', { since: cloudSince });
      let cloudFailed = 0;
      if (count(fromCloud.changes) > 0) {
        const r = await this.push(fromCloud.changes, 'CLOUD');
        down = r.applied;
        cloudFailed = r.failed;
      }
      // Курсор двигаем ТОЛЬКО если всё применилось: упавшие строки (FK-каскад,
      // дедлок, таймаут, конфликт) иначе были бы навсегда исключены `gt` — тихая
      // потеря данных. При failed>0 окно перечитается на следующем цикле (P0-13).
      if (cloudFailed === 0) {
        await setCursor('cloudPull', cursorFrom(fromCloud.until));
      }

      // 2) Локал → Облако
      const localSince = await getCursor('localPull');
      const fromLocal = await this.pull(localSince);
      let localFailed = 0;
      if (count(fromLocal.changes) > 0) {
        const r = await callCloud('/sync/push', {
          changes: fromLocal.changes,
          peer: NODE_ID,
        });
        up = r.applied;
        localFailed = Number(r.failed ?? 0);
      }
      if (localFailed === 0) {
        await setCursor('localPull', cursorFrom(fromLocal.until));
      }

      await this.heartbeat();
      return { ok: true, up, down, at: new Date().toISOString() };
    } catch (e: any) {
      throw new ServiceUnavailableException(
        `Не удалось синхронизироваться: ${e?.message ?? e}`,
      );
    }
  }
}
