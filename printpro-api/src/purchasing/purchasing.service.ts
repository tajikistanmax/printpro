import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateReceiptDto,
  CreateSupplierDto,
  UpdateSupplierDto,
} from './dto/purchasing.dto';
import { docNumber } from '../common/doc-number';

@Injectable()
export class PurchasingService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Поставщики ----------
  createSupplier(dto: CreateSupplierDto) {
    return this.prisma.supplier.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        phone: dto.phone,
        note: dto.note,
      },
    });
  }

  listSuppliers(companyId: string) {
    return this.prisma.supplier.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    await this.ensureSupplier(id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  // ---------- Приёмка товара (приход на склад) ----------
  async createReceipt(dto: CreateReceiptDto) {
    if (!dto.items?.length) {
      throw new BadRequestException('Добавьте хотя бы одну позицию');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Документ приёмки (с номером приходной накладной)
      const count = await tx.stockReceipt.count({
        where: { companyId: dto.companyId },
      });
      const receipt = await tx.stockReceipt.create({
        data: {
          companyId: dto.companyId,
          number: docNumber('PRIH', count + 1),
          supplierId: dto.supplierId,
          branchId: dto.branchId,
          note: dto.note,
          items: {
            create: dto.items.map((it) => ({
              productId: it.productId,
              quantity: it.quantity,
              cost: it.cost ?? 0,
            })),
          },
        },
        include: { supplier: true },
      });

      // 2. По каждой позиции: остаток + движение склада
      for (const it of dto.items) {
        await tx.stock.upsert({
          where: {
            productId_branchId: {
              productId: it.productId,
              branchId: dto.branchId,
            },
          },
          create: {
            productId: it.productId,
            branchId: dto.branchId,
            quantity: it.quantity,
          },
          update: { quantity: { increment: it.quantity } },
        });

        await tx.stockMovement.create({
          data: {
            companyId: dto.companyId,
            productId: it.productId,
            branchId: dto.branchId,
            type: StockMovementType.IN,
            quantity: it.quantity,
            reason: receipt.supplier
              ? `Приёмка от «${receipt.supplier.name}»`
              : 'Приёмка товара',
          },
        });
      }

      return this.loadReceipt(tx, receipt.id);
    });
  }

  listReceipts(companyId: string) {
    return this.prisma.stockReceipt.findMany({
      where: { companyId },
      include: {
        supplier: { select: { name: true } },
        branch: { select: { name: true } },
        items: true,
      },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async findReceipt(id: string) {
    const receipt = await this.loadReceipt(this.prisma, id);
    if (!receipt) throw new NotFoundException('Приёмка не найдена');
    return receipt;
  }

  // ---------- helpers ----------
  private loadReceipt(db: any, id: string) {
    return db.stockReceipt.findUnique({
      where: { id },
      include: {
        supplier: true,
        branch: { select: { name: true } },
        items: { include: { product: { include: { unit: true } } } },
      },
    });
  }

  private async ensureSupplier(id: string) {
    const s = await this.prisma.supplier.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Поставщик не найден');
    return s;
  }
}
