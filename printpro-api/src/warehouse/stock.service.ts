import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  // Приём товара (приход): увеличиваем остаток + записываем движение
  async receive(dto: ReceiveStockDto) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Записываем движение склада (история)
      await tx.stockMovement.create({
        data: {
          companyId: dto.companyId,
          productId: dto.productId,
          branchId: dto.branchId,
          type: StockMovementType.IN,
          quantity: dto.quantity,
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
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.stock.findUnique({
        where: {
          productId_branchId: {
            productId: dto.productId,
            branchId: dto.branchId,
          },
        },
      });

      const available = current ? Number(current.quantity) : 0;
      if (available < dto.quantity) {
        throw new BadRequestException(
          `Недостаточно товара на складе. Доступно: ${available}`,
        );
      }

      await tx.stockMovement.create({
        data: {
          companyId: dto.companyId,
          productId: dto.productId,
          branchId: dto.branchId,
          type: dto.type,
          quantity: dto.quantity,
          reason: dto.reason ?? 'Списание',
          userId: dto.userId,
        },
      });

      return tx.stock.update({
        where: {
          productId_branchId: {
            productId: dto.productId,
            branchId: dto.branchId,
          },
        },
        data: { quantity: { decrement: dto.quantity } },
        include: { product: true, branch: true },
      });
    });
  }

  // Текущие остатки по компании
  listStock(companyId: string) {
    return this.prisma.stock.findMany({
      where: { product: { companyId } },
      include: { product: { include: { unit: true } }, branch: true },
      orderBy: { product: { name: 'asc' } },
    });
  }

  // ОПОВЕЩЕНИЕ: товары, у которых остаток <= порога (minStock)
  async lowStock(companyId: string) {
    // Берём остатки, где у товара задан порог (minStock > 0)
    const rows = await this.prisma.stock.findMany({
      where: {
        product: { companyId, minStock: { gt: new Prisma.Decimal(0) } },
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
