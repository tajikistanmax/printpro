import { Injectable, NotFoundException } from '@nestjs/common';
import { PricingType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Параметры расчёта позиции (что выбрал менеджер/касса).
export interface PriceInput {
  serviceId: string;
  quantity: number;
  sizeId?: string; // выбранный размер (для BY_SIZE)
  optionIds?: string[]; // выбранные опции (доплаты)
  area?: number; // площадь м² (для BY_AREA)
  needsDesign?: boolean; // нужна доплата за дизайн
}

export interface PriceResult {
  serviceId: string;
  pricingType: PricingType;
  manual: boolean; // договорная цена (MANUAL) — считать нечего, вводит менеджер
  unitPrice: number; // цена за единицу (база по типу + опции)
  designSurcharge: number; // доплата за дизайн (разово на позицию)
  minQuantity: number;
  effectiveQty: number; // фактическое кол-во с учётом минимального тиража
  lineTotal: number; // unitPrice * effectiveQty + designSurcharge
}

// Серверный расчёт цены услуги из справочника (единый источник истины):
// тираж (priceTiers), размер (sizes), площадь (BY_AREA), опции (priceModifier),
// доплата за дизайн, минимальный тираж. MANUAL — договорная (не считаем).
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  // Расчёт по одной услуге (проверяем принадлежность компании)
  async preview(companyId: string, input: PriceInput): Promise<PriceResult> {
    const service = await this.prisma.service.findFirst({
      where: { id: input.serviceId, companyId, deletedAt: null },
      include: { priceTiers: true, sizes: true, options: true },
    });
    if (!service) throw new NotFoundException('Услуга не найдена');
    return this.calc(service, input);
  }

  // Чистый расчёт по уже загруженной услуге (с priceTiers/sizes/options).
  calc(
    service: {
      id: string;
      pricingType: PricingType;
      basePrice: unknown;
      designSurcharge: unknown;
      minQuantity: number;
      priceTiers: { minQty: number; maxQty: number | null; price: unknown }[];
      sizes: { id: string; price: unknown }[];
      options: { id: string; priceModifier: unknown }[];
    },
    input: PriceInput,
  ): PriceResult {
    const qty = Math.max(Number(input.quantity) || 0, 0);
    const minQuantity = service.minQuantity || 1;
    const effectiveQty = Math.max(qty, minQuantity);

    if (service.pricingType === PricingType.MANUAL) {
      return {
        serviceId: service.id,
        pricingType: service.pricingType,
        manual: true,
        unitPrice: 0,
        designSurcharge: 0,
        minQuantity,
        effectiveQty,
        lineTotal: 0,
      };
    }

    // Базовая цена по типу ценообразования
    let base = Number(service.basePrice);
    if (service.pricingType === PricingType.QUANTITY_TIER) {
      const tier = service.priceTiers.find(
        (t) => qty >= t.minQty && (t.maxQty == null || qty <= t.maxQty),
      );
      if (tier) base = Number(tier.price);
    } else if (service.pricingType === PricingType.BY_SIZE) {
      const size = input.sizeId
        ? service.sizes.find((s) => s.id === input.sizeId)
        : undefined;
      if (size) base = Number(size.price);
    } else if (service.pricingType === PricingType.BY_AREA) {
      const area = Number(input.area) || 0;
      if (area > 0) base = Number(service.basePrice) * area;
    }

    // Доплаты за выбранные опции (тип бумаги, ламинация и т.п.)
    let optSum = 0;
    if (input.optionIds?.length) {
      for (const o of service.options) {
        if (input.optionIds.includes(o.id)) optSum += Number(o.priceModifier);
      }
    }

    const unitPrice = Number((base + optSum).toFixed(2));
    const designSurcharge = input.needsDesign
      ? Number(service.designSurcharge)
      : 0;
    const lineTotal = Number(
      (unitPrice * effectiveQty + designSurcharge).toFixed(2),
    );

    return {
      serviceId: service.id,
      pricingType: service.pricingType,
      manual: false,
      unitPrice,
      designSurcharge,
      minQuantity,
      effectiveQty,
      lineTotal,
    };
  }
}
