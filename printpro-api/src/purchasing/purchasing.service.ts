import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StockMovementType, ReceiptPaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateReceiptDto,
  CreateSupplierDto,
  UpdateSupplierDto,
  PaySupplierDebtDto,
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
        inn: dto.inn,
        note: dto.note,
      },
    });
  }

  // Оплата нашего долга поставщику: запись оплаты + уменьшение долга + расход из кассы
  async paySupplierDebt(id: string, dto: PaySupplierDebtDto, userId?: string) {
    const supplier = await this.ensureSupplier(id);
    const pay = Number(dto.amount.toFixed(2));
    return this.prisma.$transaction(async (tx) => {
      await tx.supplierPayment.create({
        data: {
          companyId: supplier.companyId,
          supplierId: id,
          amount: pay,
          note: dto.note,
          userId,
        },
      });
      const newDebt = Number(Math.max(0, Number(supplier.debt) - pay).toFixed(2));
      await tx.supplier.update({ where: { id }, data: { debt: newDebt } });
      // Расход из кассы, привязанный к открытой смене кассира — иначе оплата
      // поставщику не попадёт в Z-отчёт и завысит остаток наличных.
      const shiftId = await this.openShiftId(tx, supplier.companyId, userId);
      await tx.cashMovement.create({
        data: {
          companyId: supplier.companyId,
          shiftId,
          type: 'OUT',
          amount: pay,
          category: 'Поставщики',
          reason: `Оплата долга поставщику «${supplier.name}»`,
        },
      });
      return tx.supplier.findUnique({ where: { id } });
    });
  }

  // Открытая смена кассира — для привязки расходов кассы к Z-отчёту.
  private async openShiftId(
    tx: any,
    companyId: string,
    userId?: string,
  ): Promise<string | undefined> {
    if (!userId) return undefined;
    const shift = await tx.cashShift.findFirst({
      where: { companyId, userId, closedAt: null },
    });
    return shift?.id;
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
  async createReceipt(dto: CreateReceiptDto, userId?: string) {
    if (!dto.items?.length) {
      throw new BadRequestException('Добавьте хотя бы одну позицию');
    }

    // Сумма приёмки, оплата поставщику и статус
    const total = Number(
      dto.items.reduce((s, it) => s + (it.cost ?? 0) * it.quantity, 0).toFixed(2),
    );
    const paidAmount = Number((dto.paidAmount ?? total).toFixed(2));
    const debt = Number(Math.max(0, total - paidAmount).toFixed(2));
    const paymentStatus: ReceiptPaymentStatus =
      paidAmount >= total
        ? ReceiptPaymentStatus.PAID
        : paidAmount > 0
          ? ReceiptPaymentStatus.PARTIAL
          : ReceiptPaymentStatus.DEBT;

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
          total,
          paidAmount,
          paymentStatus,
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

      // 2. По каждой позиции: остаток (до/после) + движение + закупочная цена товара
      for (const it of dto.items) {
        const prev = await tx.stock.findUnique({
          where: {
            productId_branchId: { productId: it.productId, branchId: dto.branchId },
          },
        });
        const beforeQty = prev ? Number(prev.quantity) : 0;

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

        // Обновляем закупочную цену товара по последней приёмке (для отчёта прибыли)
        if (it.cost != null && it.cost > 0) {
          await tx.product.update({
            where: { id: it.productId },
            data: { purchasePrice: it.cost },
          });
        }

        await tx.stockMovement.create({
          data: {
            companyId: dto.companyId,
            productId: it.productId,
            branchId: dto.branchId,
            type: StockMovementType.IN,
            quantity: it.quantity,
            beforeQty,
            afterQty: Number((beforeQty + Number(it.quantity)).toFixed(3)),
            reason: receipt.supplier
              ? `Приёмка от «${receipt.supplier.name}»`
              : 'Приёмка товара',
          },
        });
      }

      // 3. Долг поставщику, если оплатили не полностью
      if (dto.supplierId && debt > 0) {
        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: { debt: { increment: debt } },
        });
      }

      // 4. Оплата поставщику при приёмке — расход из кассы, привязанный к смене.
      // Без этого деньги, отданные поставщику, не отражаются в учёте кассы.
      if (paidAmount > 0) {
        const shiftId = await this.openShiftId(tx, dto.companyId, userId);
        await tx.cashMovement.create({
          data: {
            companyId: dto.companyId,
            shiftId,
            type: 'OUT',
            amount: paidAmount,
            category: 'Поставщики',
            reason: receipt.supplier
              ? `Оплата при приёмке №${receipt.number} («${receipt.supplier.name}»)`
              : `Оплата при приёмке №${receipt.number}`,
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
