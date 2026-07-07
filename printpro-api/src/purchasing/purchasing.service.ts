import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StockMovementType, ReceiptPaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateReceiptDto,
  CreateSupplierDto,
  UpdateSupplierDto,
  PaySupplierDebtDto,
  CreatePurchaseRequestDto,
} from './dto/purchasing.dto';
import { docNumber } from '../common/doc-number';
import { nextSeq } from '../common/next-number';

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
  async paySupplierDebt(
    id: string,
    dto: PaySupplierDebtDto,
    userId?: string,
    companyId?: string,
  ) {
    const supplier = await this.ensureSupplier(id, companyId);
    return this.prisma.$transaction(async (tx) => {
      // Свежий остаток долга берём ВНУТРИ транзакции и списываем его атомарно
      // (updateMany + guard debt >= pay). Иначе два параллельных запроса прочитали бы
      // один и тот же долг и дважды списали деньги из кассы.
      const fresh = await tx.supplier.findUnique({
        where: { id },
        select: { debt: true },
      });
      const outstanding = Number(fresh?.debt ?? 0);
      const pay = Number(Math.min(dto.amount, outstanding).toFixed(2));
      if (pay <= 0) throw new BadRequestException('У поставщика нет долга к оплате');

      const dec = await tx.supplier.updateMany({
        where: { id, debt: { gte: pay } },
        data: { debt: { decrement: pay } },
      });
      if (dec.count === 0) {
        throw new BadRequestException(
          'Долг изменился (возможно, оплачен параллельно) — обновите и повторите',
        );
      }

      await tx.supplierPayment.create({
        data: {
          companyId: supplier.companyId,
          supplierId: id,
          amount: pay,
          note: dto.note,
          userId,
        },
      });

      // С3: гасим приёмки этого поставщика (старые первыми), пока хватает оплаты.
      // Раньше долг уменьшался, но StockReceipt.paymentStatus навсегда оставался
      // «в долг/просрочено». Теперь оплата распределяется по приёмкам.
      let left = pay;
      const openReceipts = await tx.stockReceipt.findMany({
        where: {
          companyId: supplier.companyId,
          supplierId: id,
          deletedAt: null,
          paymentStatus: {
            in: [ReceiptPaymentStatus.DEBT, ReceiptPaymentStatus.PARTIAL],
          },
        },
        orderBy: { date: 'asc' },
      });
      for (const r of openReceipts) {
        if (left <= 0.001) break;
        const outstanding = Number(
          (Number(r.total) - Number(r.paidAmount)).toFixed(2),
        );
        if (outstanding <= 0) continue;
        const alloc = Number(Math.min(left, outstanding).toFixed(2));
        const newPaid = Number((Number(r.paidAmount) + alloc).toFixed(2));
        const fullyPaid = newPaid >= Number(r.total) - 0.001;
        await tx.stockReceipt.update({
          where: { id: r.id },
          data: {
            paidAmount: newPaid,
            paymentStatus: fullyPaid
              ? ReceiptPaymentStatus.PAID
              : ReceiptPaymentStatus.PARTIAL,
            dueDate: fullyPaid ? null : r.dueDate,
          },
        });
        left = Number((left - alloc).toFixed(2));
      }
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
      // Аудит оплаты долга поставщику со снимком остатка долга (P1-9d)
      await this.audit.recordTx(tx, {
        companyId: supplier.companyId,
        userId,
        action: 'money:supplier-payment',
        entity: 'supplier',
        entityId: id,
        before: { debt: outstanding },
        after: { debt: Number((outstanding - pay).toFixed(2)), paid: pay },
      });
      return tx.supplier.findUnique({ where: { id } });
    });
  }

  // Открытая смена кассира — для привязки расходов кассы к Z-отчёту.
  private async openShiftId(
    tx: any,
    companyId: string,
    userId?: string,
  ): Promise<string> {
    if (!userId) throw new BadRequestException('Open cash shift not found');
    const shift = await tx.cashShift.findFirst({
      where: { companyId, userId, closedAt: null, deletedAt: null },
    });
    if (!shift) throw new BadRequestException('Open cash shift not found');
    return shift.id;
  }

  listSuppliers(companyId: string) {
    return this.prisma.supplier.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto, companyId?: string) {
    await this.ensureSupplier(id, companyId);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  // ---------- Приёмка товара (приход на склад) ----------
  async createReceipt(dto: CreateReceiptDto, userId?: string) {
    if (!dto.items?.length) {
      throw new BadRequestException('Добавьте хотя бы одну позицию');
    }

    // Tenant-проверка: supplierId/branchId приходят из тела запроса — убеждаемся,
    // что они принадлежат компании из токена, иначе приёмка от компании A могла бы
    // инкрементить долг чужого поставщика и писать в чужой склад. (P0-7)
    if (dto.supplierId) {
      await this.ensureSupplier(dto.supplierId, dto.companyId);
    }
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, companyId: dto.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('Филиал не найден');

    // Tenant-проверка товаров позиций: productId приходит из тела запроса —
    // без проверки компания A могла бы приёмкой менять остатки/цены чужого
    // товара компании B (через product.update и stock.upsert по чужому productId).
    const productIds = [...new Set(dto.items.map((it) => it.productId))];
    const ownedProducts = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId: dto.companyId, deletedAt: null },
      select: { id: true },
    });
    if (ownedProducts.length !== productIds.length) {
      throw new BadRequestException('Один или несколько товаров не найдены');
    }

    // Сумма приёмки, оплата поставщику и статус
    const total = Number(
      dto.items.reduce((s, it) => s + (it.cost ?? 0) * it.quantity, 0).toFixed(2),
    );
    // Оплата не может превышать сумму приёмки (иначе из кассы уйдёт лишнее).
    const paidAmount = Number(Math.min(dto.paidAmount ?? total, total).toFixed(2));
    const debt = Number(Math.max(0, total - paidAmount).toFixed(2));
    const paymentStatus: ReceiptPaymentStatus =
      paidAmount >= total
        ? ReceiptPaymentStatus.PAID
        : paidAmount > 0
          ? ReceiptPaymentStatus.PARTIAL
          : ReceiptPaymentStatus.DEBT;
    // Долг без поставщика запрещён: приёмка в долг/частично создала бы неоплачиваемый
    // долг, невидимый в балансах поставщиков (paySupplierDebt гасит только долг
    // конкретного поставщика). Если оплачено не полностью — поставщик обязателен.
    if (debt > 0 && !dto.supplierId) {
      throw new BadRequestException(
        'Приёмка в долг невозможна без поставщика — укажите поставщика или оплатите полностью',
      );
    }
    // Оплата из кассового ящика (по умолчанию) или из другого источника.
    // Если НЕ из кассы — расход по смене не создаём (касса не уменьшается).
    const paidFromCash = dto.paidFromCash ?? true;

    return this.prisma.$transaction(async (tx) => {
      // 1. Документ приёмки (с номером приходной накладной)
      const prihSeq = await nextSeq(tx, dto.companyId, 'PRIH');
      const receipt = await tx.stockReceipt.create({
        data: {
          companyId: dto.companyId,
          number: docNumber('PRIH', prihSeq),
          supplierId: dto.supplierId,
          branchId: dto.branchId,
          note: dto.note,
          total,
          paidAmount,
          paymentStatus,
          paidFromCash,
          // Срок оплаты фиксируем только когда остался долг
          dueDate: debt > 0 && dto.dueDate ? new Date(dto.dueDate) : null,
          items: {
            create: dto.items.map((it) => ({
              productId: it.productId,
              quantity: it.quantity,
              cost: it.cost ?? 0,
              salePrice: it.salePrice ?? null,
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

        // Обновляем цены товара по приёмке: закупочную (для отчёта прибыли)
        // и, если задана, новую цену продажи.
        const priceData: { purchasePrice?: number; salePrice?: number } = {};
        if (it.cost != null && it.cost > 0) priceData.purchasePrice = it.cost;
        if (it.salePrice != null && it.salePrice > 0)
          priceData.salePrice = it.salePrice;
        if (Object.keys(priceData).length) {
          await tx.product.update({
            where: { id: it.productId },
            data: priceData,
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
      // Только если оплата взята ИЗ КАССЫ (галочка). Если из другого источника
      // (перевод/карта/личные) — кассовый ящик и Z-отчёт не трогаем, открытая
      // смена не требуется; при этом paidAmount на приёмке уже уменьшил долг.
      if (paidAmount > 0 && paidFromCash) {
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

      // Сводный аудит складской стороны приёмки (P1-9d): детали по позициям —
      // в StockMovement (before/after остатка), здесь — факт и объём прихода.
      await this.audit.recordTx(tx, {
        companyId: dto.companyId,
        userId,
        action: 'stock:receipt',
        entity: 'stockReceipt',
        entityId: receipt.id,
        after: {
          branchId: dto.branchId,
          itemsCount: dto.items.length,
          totalQuantity: Number(
            dto.items.reduce((s, it) => s + Number(it.quantity), 0).toFixed(3),
          ),
        },
      });

      // Аудит денежной стороны приёмки (P1-9d): сумма, оплата, возникший долг
      await this.audit.recordTx(tx, {
        companyId: dto.companyId,
        userId,
        action: 'money:receipt',
        entity: 'stockReceipt',
        entityId: receipt.id,
        after: {
          number: receipt.number,
          supplierId: dto.supplierId ?? null,
          total,
          paidAmount,
          debt,
          paymentStatus,
          paidFromCash,
        },
      });

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

  async findReceipt(id: string, companyId?: string) {
    const receipt = await this.loadReceipt(this.prisma, id);
    if (!receipt) throw new NotFoundException('Приёмка не найдена');
    if (companyId && receipt.companyId !== companyId) {
      throw new NotFoundException('Приёмка не найдена');
    }
    return receipt;
  }

  // ---------- Заявки на закупку (снимок «что и когда заказывали») ----------
  async createRequest(dto: CreatePurchaseRequestDto, userId?: string) {
    if (!dto.items?.length) {
      throw new BadRequestException('Добавьте хотя бы одну позицию');
    }
    const totalQty = Number(
      dto.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0).toFixed(3),
    );
    const zakSeq = await nextSeq(this.prisma, dto.companyId, 'ZAK');
    return this.prisma.purchaseRequest.create({
      data: {
        companyId: dto.companyId,
        number: docNumber('ZAK', zakSeq),
        supplierName: dto.supplierName,
        note: dto.note,
        items: dto.items as any,
        totalQty,
        createdById: userId,
      },
    });
  }

  listRequests(companyId: string) {
    return this.prisma.purchaseRequest.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
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

  // companyId (из токена) — поставщик чужой компании считается «не найден».
  private async ensureSupplier(id: string, companyId?: string) {
    const s = await this.prisma.supplier.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Поставщик не найден');
    if (companyId && s.companyId !== companyId) {
      throw new NotFoundException('Поставщик не найден');
    }
    return s;
  }
}
