import { BadRequestException, Injectable } from '@nestjs/common';
import { DiscountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromocodeDto } from './dto/create-promocode.dto';

@Injectable()
export class PromocodesService {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, dto: CreatePromocodeDto) {
    return this.prisma.promoCode.create({
      data: {
        companyId,
        code: dto.code.trim().toUpperCase(),
        discountType: dto.discountType ?? DiscountType.PERCENT,
        value: dto.value,
        maxUses: dto.maxUses ?? null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      },
    });
  }

  findAll(companyId: string) {
    return this.prisma.promoCode.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(companyId: string, id: string) {
    await this.prisma.promoCode.updateMany({
      where: { id, companyId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  // Вычислить размер скидки для суммы с учётом ограничений
  private calcDiscount(
    discountType: DiscountType,
    value: number,
    subtotal: number,
  ) {
    if (discountType === DiscountType.PERCENT) {
      // Процент не может превышать 100, а скидка — сумму заказа
      const percent = Math.min(value, 100);
      const raw = Number(((subtotal * percent) / 100).toFixed(2));
      return Math.min(raw, subtotal);
    }
    // Фиксированная сумма не может превышать сумму заказа
    return Math.min(value, subtotal);
  }

  // Проверка кода: вернуть размер скидки для суммы (без списания)
  async validate(companyId: string, code: string, subtotal: number) {
    const promo = await this.prisma.promoCode.findFirst({
      where: { companyId, code: code.trim().toUpperCase(), deletedAt: null },
    });
    if (!promo || !promo.isActive) {
      return { valid: false, discount: 0, message: 'Промокод не найден' };
    }
    if (promo.validUntil && promo.validUntil.getTime() < Date.now()) {
      return { valid: false, discount: 0, message: 'Срок промокода истёк' };
    }
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
      return {
        valid: false,
        discount: 0,
        message: 'Лимит использований исчерпан',
      };
    }
    const discount = this.calcDiscount(
      promo.discountType,
      Number(promo.value),
      subtotal,
    );
    return { valid: true, discount, code: promo.code };
  }

  // Применить код (списание использования) — используется при продаже
  async consume(companyId: string, code: string, subtotal: number) {
    const res = await this.validate(companyId, code, subtotal);
    if (!res.valid) throw new BadRequestException(res.message);

    // Атомарно списываем использование: инкремент проходит только если код
    // всё ещё активен, не истёк и лимит не исчерпан. Между validate и этим
    // апдейтом код мог отключиться/истечь/исчерпаться при параллельной продаже —
    // все условия проверяем прямо в where, чтобы не «съесть» недоступный код.
    const normalizedCode = code.trim().toUpperCase();
    const { count } = await this.prisma.promoCode.updateMany({
      where: {
        companyId,
        code: normalizedCode,
        deletedAt: null,
        isActive: true,
        AND: [
          { OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
          {
            OR: [
              { maxUses: null },
              { usedCount: { lt: this.prisma.promoCode.fields.maxUses } },
            ],
          },
        ],
      },
      data: { usedCount: { increment: 1 } },
    });
    if (count === 0) {
      throw new BadRequestException('Промокод недоступен (истёк, отключён или исчерпан)');
    }
    return res.discount;
  }

  // Вернуть использование кода — компенсация при откате незавершённой продажи,
  // чтобы отменённый чек не «съедал» лимит промокода. Ниже нуля не опускаем.
  async release(companyId: string, code: string) {
    const normalizedCode = code.trim().toUpperCase();
    await this.prisma.promoCode.updateMany({
      where: {
        companyId,
        code: normalizedCode,
        deletedAt: null,
        usedCount: { gt: 0 },
      },
      data: { usedCount: { decrement: 1 } },
    });
  }
}
