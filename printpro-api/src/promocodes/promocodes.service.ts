import { BadRequestException, Injectable } from '@nestjs/common';
import { DiscountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PromocodesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: {
    companyId: string;
    code: string;
    discountType?: DiscountType;
    value: number;
    maxUses?: number | null;
    validUntil?: string;
  }) {
    return this.prisma.promoCode.create({
      data: {
        companyId: dto.companyId,
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

  async remove(id: string) {
    await this.prisma.promoCode.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
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
      return { valid: false, discount: 0, message: 'Лимит использований исчерпан' };
    }
    const discount =
      promo.discountType === DiscountType.PERCENT
        ? Number(((subtotal * Number(promo.value)) / 100).toFixed(2))
        : Math.min(Number(promo.value), subtotal);
    return { valid: true, discount, code: promo.code };
  }

  // Применить код (списание использования) — используется при продаже
  async consume(companyId: string, code: string, subtotal: number) {
    const res = await this.validate(companyId, code, subtotal);
    if (!res.valid) throw new BadRequestException(res.message);
    await this.prisma.promoCode.updateMany({
      where: { companyId, code: code.trim().toUpperCase(), deletedAt: null },
      data: { usedCount: { increment: 1 } },
    });
    return res.discount;
  }
}
