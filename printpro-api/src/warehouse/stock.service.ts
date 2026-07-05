import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto, RecountStockDto } from './dto/transfer-stock.dto';
import { WriteOffDto } from './dto/write-off.dto';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureProduct(
    db: Prisma.TransactionClient | PrismaService,
    companyId: string,
    productId: string,
  ) {
    const product = await db.product.findFirst({
      where: { id: productId, companyId, deletedAt: null },
      select: { id: true, purchasePrice: true },
    });
    if (!product) throw new BadRequestException('Product not found');
    return product;
  }

  private async ensureBranch(
    db: Prisma.TransactionClient | PrismaService,
    companyId: string,
    branchId: string,
  ) {
    const branch = await db.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('Branch not found');
    return branch;
  }

  // Сводка для карточек склада: поставщиков + поступления сегодня (по закупкам)
  async stats(companyId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [suppliers, items] = await Promise.all([
      this.prisma.supplier.count({ where: { companyId, deletedAt: null } }),
      this.prisma.stockReceiptItem.findMany({
        where: {
          deletedAt: null,
          receipt: { companyId, date: { gte: todayStart } },
        },
        select: { cost: true, quantity: true },
      }),
    ]);
    const todayReceipts = items.reduce(
      (s, i) => s + Number(i.cost) * Number(i.quantity),
      0,
    );
    return { suppliers, todayReceipts };
  }

  // Приём товара (приход): увеличиваем остаток + записываем движение
  async receive(dto: ReceiveStockDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureProduct(tx, dto.companyId, dto.productId);
      await this.ensureBranch(tx, dto.companyId, dto.branchId);
      // Остаток до прихода (для аудита «до/после»)
      const prev = await tx.stock.findUnique({
        where: {
          productId_branchId: { productId: dto.productId, branchId: dto.branchId },
        },
      });
      const beforeQty = prev ? Number(prev.quantity) : 0;

      // 1. Записываем движение склада (история)
      await tx.stockMovement.create({
        data: {
          companyId: dto.companyId,
          productId: dto.productId,
          branchId: dto.branchId,
          type: StockMovementType.IN,
          quantity: dto.quantity,
          beforeQty,
          afterQty: Number((beforeQty + Number(dto.quantity)).toFixed(3)),
          reason: dto.reason ?? 'Приход товара',
          userId: dto.userId,
        },
      });

      // 2. Обновляем (или создаём) остаток на складе
      const stock = await tx.stock.upsert({
        where: {
          productId_branchId: {
            productId: dto.productId,
            branchId: dto.branchId,
          },
        },
        create: {
          productId: dto.productId,
          branchId: dto.branchId,
          quantity: dto.quantity,
        },
        update: { quantity: { increment: dto.quantity } },
        include: { product: true, branch: true },
      });

      return stock;
    });
  }

  // Списание / корректировка (уменьшаем остаток)
  async adjust(dto: AdjustStockDto) {
    // Эта операция только СПИСЫВАЕТ остаток. Приходные типы (IN/RETURN) молча
    // уменьшили бы склад — отклоняем их с подсказкой, куда идти за приходом.
    if (dto.type === StockMovementType.IN || dto.type === StockMovementType.RETURN) {
      throw new BadRequestException(
        'Приход товара — через «Закупки», перемещение — через transfer, ' +
          'инвентаризация — через пересчёт. Здесь только списание/корректировка.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await this.ensureProduct(tx, dto.companyId, dto.productId);
      await this.ensureBranch(tx, dto.companyId, dto.branchId);
      // Условное списание: атомарно уменьшаем, только если остатка хватает.
      const dec = await tx.stock.updateMany({
        where: {
          productId: dto.productId,
          branchId: dto.branchId,
          quantity: { gte: dto.quantity },
        },
        data: { quantity: { decrement: dto.quantity } },
      });
      if (dec.count === 0) {
        const cur = await tx.stock.findUnique({
          where: {
            productId_branchId: {
              productId: dto.productId,
              branchId: dto.branchId,
            },
          },
        });
        throw new BadRequestException(
          `Недостаточно товара на складе. Доступно: ${cur ? Number(cur.quantity) : 0}`,
        );
      }
      const after = await tx.stock.findUnique({
        where: {
          productId_branchId: {
            productId: dto.productId,
            branchId: dto.branchId,
          },
        },
        include: { product: true, branch: true },
      });
      const afterQty = after ? Number(after.quantity) : 0;

      await tx.stockMovement.create({
        data: {
          companyId: dto.companyId,
          productId: dto.productId,
          branchId: dto.branchId,
          type: dto.type,
          quantity: dto.quantity,
          beforeQty: Number((afterQty + Number(dto.quantity)).toFixed(3)),
          afterQty,
          reason: dto.reason ?? 'Списание',
          userId: dto.userId,
        },
      });

      return after;
    });
  }

  // Перемещение между филиалами
  async transfer(dto: TransferStockDto) {
    if (dto.fromBranchId === dto.toBranchId) {
      throw new BadRequestException('Филиалы должны отличаться');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.ensureProduct(tx, dto.companyId, dto.productId);
      await this.ensureBranch(tx, dto.companyId, dto.fromBranchId);
      await this.ensureBranch(tx, dto.companyId, dto.toBranchId);
      const qty = Number(dto.quantity);
      // Списываем из источника условно (атомарно), чтобы не увести в минус.
      const dec = await tx.stock.updateMany({
        where: {
          productId: dto.productId,
          branchId: dto.fromBranchId,
          quantity: { gte: dto.quantity },
        },
        data: { quantity: { decrement: dto.quantity } },
      });
      if (dec.count === 0) {
        const cur = await tx.stock.findUnique({
          where: {
            productId_branchId: {
              productId: dto.productId,
              branchId: dto.fromBranchId,
            },
          },
        });
        throw new BadRequestException(
          `Недостаточно товара в филиале-источнике. Доступно: ${cur ? Number(cur.quantity) : 0}`,
        );
      }
      const srcAfter = await tx.stock.findUnique({
        where: {
          productId_branchId: {
            productId: dto.productId,
            branchId: dto.fromBranchId,
          },
        },
      });
      const available = Number((Number(srcAfter?.quantity ?? 0) + qty).toFixed(3));
      // Остаток приёмника до перемещения (для аудита «до/после»)
      const dst = await tx.stock.findUnique({
        where: {
          productId_branchId: { productId: dto.productId, branchId: dto.toBranchId },
        },
      });
      const destBefore = dst ? Number(dst.quantity) : 0;

      // Зачисляем в приёмник
      await tx.stock.upsert({
        where: {
          productId_branchId: {
            productId: dto.productId,
            branchId: dto.toBranchId,
          },
        },
        create: {
          productId: dto.productId,
          branchId: dto.toBranchId,
          quantity: dto.quantity,
        },
        update: { quantity: { increment: dto.quantity } },
      });

      // Два движения: расход из источника, приход в приёмник
      await tx.stockMovement.createMany({
        data: [
          {
            companyId: dto.companyId,
            productId: dto.productId,
            branchId: dto.fromBranchId,
            type: StockMovementType.OUT,
            quantity: dto.quantity,
            beforeQty: available,
            afterQty: Number((available - qty).toFixed(3)),
            reason: 'Перемещение между филиалами',
            userId: dto.userId,
          },
          {
            companyId: dto.companyId,
            productId: dto.productId,
            branchId: dto.toBranchId,
            type: StockMovementType.IN,
            quantity: dto.quantity,
            beforeQty: destBefore,
            afterQty: Number((destBefore + qty).toFixed(3)),
            reason: 'Перемещение между филиалами',
            userId: dto.userId,
          },
        ],
      });

      return { ok: true };
    });
  }

  // Инвентаризация: выставить фактический остаток, зафиксировать расхождение
  async recount(dto: RecountStockDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureProduct(tx, dto.companyId, dto.productId);
      await this.ensureBranch(tx, dto.companyId, dto.branchId);
      const current = await tx.stock.findUnique({
        where: {
          productId_branchId: {
            productId: dto.productId,
            branchId: dto.branchId,
          },
        },
      });
      const was = current ? Number(current.quantity) : 0;
      const diff = Number((dto.countedQuantity - was).toFixed(3));

      await tx.stock.upsert({
        where: {
          productId_branchId: {
            productId: dto.productId,
            branchId: dto.branchId,
          },
        },
        create: {
          productId: dto.productId,
          branchId: dto.branchId,
          quantity: dto.countedQuantity,
        },
        update: { quantity: dto.countedQuantity },
      });

      if (diff !== 0) {
        await tx.stockMovement.create({
          data: {
            companyId: dto.companyId,
            productId: dto.productId,
            branchId: dto.branchId,
            type: StockMovementType.ADJUST,
            quantity: Math.abs(diff),
            beforeQty: was,
            afterQty: dto.countedQuantity,
            reason: `Инвентаризация: было ${was}, стало ${dto.countedQuantity}`,
            userId: dto.userId,
          },
        });
      }

      return { ok: true, was, now: dto.countedQuantity, diff };
    });
  }

  // Массовая инвентаризация: выставить фактические остатки по списку товаров
  // одного филиала за один заход (атомарно). Возвращает применено/без изменений.
  async recountBulk(
    companyId: string,
    branchId: string,
    items: Array<{ productId: string; countedQuantity: number }>,
    userId?: string,
  ) {
    if (!branchId) throw new BadRequestException('Не указан филиал');
    let applied = 0;
    let unchanged = 0;
    // Инвентаризация — атомарно (всё или ничего), но на 300+ позиций дефолтный
    // 5-сек таймаут транзакции Prisma мал: поднимаем окно до 2 минут.
    await this.prisma.$transaction(
      async (tx) => {
      await this.ensureBranch(tx, companyId, branchId);
      for (const it of items) {
        const counted = Number(it.countedQuantity);
        if (!Number.isFinite(counted) || counted < 0) continue;
        await this.ensureProduct(tx, companyId, it.productId);
        const current = await tx.stock.findUnique({
          where: { productId_branchId: { productId: it.productId, branchId } },
        });
        const was = current ? Number(current.quantity) : 0;
        const diff = Number((counted - was).toFixed(3));
        if (diff === 0) {
          unchanged++;
          continue;
        }
        await tx.stock.upsert({
          where: { productId_branchId: { productId: it.productId, branchId } },
          create: { productId: it.productId, branchId, quantity: counted },
          update: { quantity: counted },
        });
        await tx.stockMovement.create({
          data: {
            companyId,
            productId: it.productId,
            branchId,
            type: StockMovementType.ADJUST,
            quantity: Math.abs(diff),
            beforeQty: was,
            afterQty: counted,
            reason: `Инвентаризация: было ${was}, стало ${counted}`,
            userId,
          },
        });
        applied++;
      }
      },
      { timeout: 120000, maxWait: 10000 },
    );
    return { applied, unchanged };
  }

  // История движений склада (последние 200)
  listMovements(companyId: string) {
    return this.prisma.stockMovement.findMany({
      where: { companyId },
      include: {
        product: { include: { unit: true } },
        branch: true,
        user: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // Текущие остатки по компании (без мягко удалённых товаров)
  listStock(companyId: string) {
    return this.prisma.stock.findMany({
      where: { product: { companyId, deletedAt: null } },
      include: { product: { include: { unit: true } }, branch: true },
      orderBy: { product: { name: 'asc' } },
    });
  }

  // ОПОВЕЩЕНИЕ: товары, у которых остаток <= порога (minStock)
  // Списание (бой/брак/порча): документ + движение WRITE_OFF + уменьшение остатка.
  // Себестоимость берём из закупочной цены товара.
  async writeOff(dto: WriteOffDto) {
    return this.prisma.$transaction(async (tx) => {
      const product = await this.ensureProduct(tx, dto.companyId, dto.productId);
      await this.ensureBranch(tx, dto.companyId, dto.branchId);
      // Условное списание: атомарно, только если остатка хватает.
      const dec = await tx.stock.updateMany({
        where: {
          productId: dto.productId,
          branchId: dto.branchId,
          quantity: { gte: dto.quantity },
        },
        data: { quantity: { decrement: dto.quantity } },
      });
      if (dec.count === 0) {
        const cur = await tx.stock.findUnique({
          where: {
            productId_branchId: { productId: dto.productId, branchId: dto.branchId },
          },
        });
        throw new BadRequestException(
          `Недостаточно товара для списания. Доступно: ${cur ? Number(cur.quantity) : 0}`,
        );
      }
      const after = await tx.stock.findUnique({
        where: {
          productId_branchId: { productId: dto.productId, branchId: dto.branchId },
        },
      });
      const afterQty = after ? Number(after.quantity) : 0;

      const cost = Number((Number(product?.purchasePrice ?? 0) * dto.quantity).toFixed(2));

      const wo = await tx.writeOff.create({
        data: {
          companyId: dto.companyId,
          branchId: dto.branchId,
          productId: dto.productId,
          quantity: dto.quantity,
          cost,
          reason: dto.reason,
          userId: dto.userId,
        },
      });

      await tx.stockMovement.create({
        data: {
          companyId: dto.companyId,
          productId: dto.productId,
          branchId: dto.branchId,
          type: StockMovementType.WRITE_OFF,
          quantity: dto.quantity,
          beforeQty: Number((afterQty + Number(dto.quantity)).toFixed(3)),
          afterQty,
          reason: dto.reason ?? 'Списание',
          userId: dto.userId,
        },
      });

      return wo;
    });
  }

  async listWriteOffs(companyId: string) {
    const rows = await this.prisma.writeOff.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const productIds = [...new Set(rows.map((r) => r.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true, name: true, unit: { select: { shortName: true } } },
    });
    const map = new Map(products.map((p) => [p.id, p]));
    return rows.map((r) => ({
      ...r,
      productName: map.get(r.productId)?.name ?? '—',
      unit: map.get(r.productId)?.unit?.shortName ?? '',
    }));
  }

  async lowStock(companyId: string) {
    // Берём остатки, где у товара задан порог (minStock > 0)
    const rows = await this.prisma.stock.findMany({
      where: {
        product: {
          companyId,
          deletedAt: null,
          minStock: { gt: new Prisma.Decimal(0) },
        },
      },
      include: { product: { include: { unit: true } }, branch: true },
    });

    // Оставляем только те, где остаток не выше порога
    return rows
      .filter((r) => Number(r.quantity) <= Number(r.product.minStock))
      .map((r) => ({
        productId: r.productId,
        productName: r.product.name,
        unit: r.product.unit?.shortName ?? '',
        branch: r.branch.name,
        quantity: Number(r.quantity),
        minStock: Number(r.product.minStock),
      }));
  }
}
