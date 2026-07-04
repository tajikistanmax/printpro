import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StockMovementType, ReceiptPaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

  async updateSupplier(id: string, dto: UpdateSupplierDto, companyId?: string) {
    await this.ensureSupplier(id, companyId);
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
    // Оплата не может превышать сумму приёмки (иначе из кассы уйдёт лишнее).
    const paidAmount = Number(Math.min(dto.paidAmount ?? total, total).toFixed(2));
    const debt = Number(Math.max(0, total - paidAmount).toFixed(2));
    const paymentStatus: ReceiptPaymentStatus =
      paidAmount >= total
        ? ReceiptPaymentStatus.PAID
        : paidAmount > 0
          ? ReceiptPaymentStatus.PARTIAL
          : ReceiptPaymentStatus.DEBT;

    return this.prisma.$transaction(async (tx) => {
      // 0. Мультитенант-защита: товары/филиал/поставщик обязаны принадлежать
      // компании из токена. Иначе приёмка с чужим productId/branchId/supplierId
      // испортила бы остатки/цены/каталог другого арендатора (companyId движения
      // = наш, а product — чужой). productId/branchId/supplierId приходят из тела.
      const productIds = [...new Set(dto.items.map((it) => it.productId))];
      const owned = await tx.product.findMany({
        where: { id: { in: productIds }, companyId: dto.companyId, deletedAt: null },
        select: { id: true },
      });
      if (owned.length !== productIds.length) {
        throw new NotFoundException('Товар не найден');
      }
      if (dto.branchId) {
        const branch = await tx.branch.findFirst({
          where: { id: dto.branchId, companyId: dto.companyId },
          select: { id: true },
        });
        if (!branch) throw new NotFoundException('Филиал не найден');
      }
      if (dto.supplierId) {
        const supplier = await tx.supplier.findFirst({
          where: { id: dto.supplierId, companyId: dto.companyId },
          select: { id: true },
        });
        if (!supplier) throw new NotFoundException('Поставщик не найден');
      }

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

  // Отмена (сторно) ошибочной приёмки: возвращаем остатки, снимаем долг
  // поставщику и возвращаем оплаченное в кассу, затем мягко удаляем документ.
  async cancelReceipt(id: string, companyId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.stockReceipt.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!receipt || receipt.deletedAt || receipt.companyId !== companyId) {
        throw new NotFoundException('Приёмка не найдена');
      }
      if (!receipt.branchId) {
        throw new BadRequestException('У приёмки не указан склад — отмена невозможна');
      }
      const branchId = receipt.branchId;

      // Идемпотентный захват документа: soft-delete первым шагом. Второй
      // параллельный вызов получит count=0 (двойное сторно исключено).
      const claim = await tx.stockReceipt.updateMany({
        where: { id, companyId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new NotFoundException('Приёмка не найдена или уже отменена');
      }

      // 1. Возвращаем остатки атомарно (guard quantity>=qty вместо чтения+записи —
      //    иначе параллельная продажа была бы потеряна). Если товар уже
      //    израсходован — отмена невозможна (транзакция откатится, включая захват).
      for (const it of receipt.items) {
        const dec = await tx.stock.updateMany({
          where: {
            productId: it.productId,
            branchId,
            quantity: { gte: Number(it.quantity) },
          },
          data: { quantity: { decrement: Number(it.quantity) } },
        });
        if (dec.count === 0) {
          throw new BadRequestException(
            'Нельзя отменить приёмку: товар уже частично израсходован (остаток меньше принятого количества)',
          );
        }
        const cur = await tx.stock.findUnique({
          where: { productId_branchId: { productId: it.productId, branchId } },
        });
        const after = cur ? Number(cur.quantity) : 0;
        const before = Number((after + Number(it.quantity)).toFixed(3));
        await tx.stockMovement.create({
          data: {
            companyId,
            productId: it.productId,
            branchId,
            type: StockMovementType.OUT,
            quantity: Number(it.quantity),
            beforeQty: before,
            afterQty: after,
            reason: `Отмена приёмки №${receipt.number}`,
            userId: userId ?? null,
          },
        });

        // Откат цен товара: восстанавливаем из последней ОСТАВШЕЙСЯ (не удалённой)
        // приёмки этого товара. Если других приёмок нет — цену не трогаем, чтобы
        // ошибочная цена не «прилипала» после сторно.
        const prevItems = await tx.stockReceiptItem.findMany({
          where: {
            productId: it.productId,
            receiptId: { not: receipt.id },
            receipt: { companyId, deletedAt: null },
          },
          select: {
            cost: true,
            salePrice: true,
            receipt: { select: { date: true } },
          },
        });
        if (prevItems.length) {
          const latest = prevItems.reduce((a, b) =>
            new Date(b.receipt.date) > new Date(a.receipt.date) ? b : a,
          );
          const priceData: { purchasePrice?: number; salePrice?: number } = {};
          if (latest.cost != null && Number(latest.cost) > 0)
            priceData.purchasePrice = Number(latest.cost);
          if (latest.salePrice != null && Number(latest.salePrice) > 0)
            priceData.salePrice = Number(latest.salePrice);
          if (Object.keys(priceData).length) {
            await tx.product.update({
              where: { id: it.productId },
              data: priceData,
            });
          }
        }
      }

      // 2. Снимаем остаток долга по этой приёмке с поставщика
      const outstanding = Number(
        (Number(receipt.total) - Number(receipt.paidAmount)).toFixed(2),
      );
      if (receipt.supplierId && outstanding > 0) {
        await tx.supplier.update({
          where: { id: receipt.supplierId },
          data: { debt: { decrement: outstanding } },
        });
      }

      // 3. Оплаченное поставщику возвращается в кассу (IN, привязано к смене)
      const paid = Number(receipt.paidAmount);
      if (paid > 0) {
        const shiftId = await this.openShiftId(tx, companyId, userId);
        await tx.cashMovement.create({
          data: {
            companyId,
            shiftId,
            type: 'IN',
            amount: paid,
            category: 'Поставщики',
            reason: `Отмена приёмки №${receipt.number}`,
          },
        });
      }

      // Документ уже помечен удалённым при захвате (см. выше).
      return { ok: true };
    });
  }

  async listReceipts(
    companyId: string,
    opts: {
      limit?: number;
      offset?: number;
      paymentStatus?: ReceiptPaymentStatus;
    } = {},
  ) {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const skip = Math.max(opts.offset ?? 0, 0);
    const where = {
      companyId,
      deletedAt: null,
      ...(opts.paymentStatus ? { paymentStatus: opts.paymentStatus } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockReceipt.findMany({
        where,
        include: {
          supplier: { select: { name: true } },
          branch: { select: { name: true } },
          items: true,
        },
        orderBy: { date: 'desc' },
        take,
        skip,
      }),
      this.prisma.stockReceipt.count({ where }),
    ]);
    return { items, total };
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

  async listRequests(
    companyId: string,
    opts: { limit?: number; offset?: number } = {},
  ) {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const skip = Math.max(opts.offset ?? 0, 0);
    const where = { companyId, deletedAt: null };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.purchaseRequest.count({ where }),
    ]);
    return { items, total };
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
