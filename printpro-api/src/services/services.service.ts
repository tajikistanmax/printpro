import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  // Создать услугу вместе с тирами цен / размерами / опциями
  create(dto: CreateServiceDto) {
    return this.prisma.service.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        categoryId: dto.categoryId,
        pricingType: dto.pricingType,
        basePrice: dto.basePrice ?? 0,
        costPrice: dto.costPrice ?? 0,
        leadTimeMin: dto.leadTimeMin ?? null,
        designSurcharge: dto.designSurcharge ?? 0,
        minQuantity: dto.minQuantity ?? 1,
        imageUrl: dto.imageUrl,
        isActive: dto.isActive ?? true,
        priceTiers: dto.priceTiers ? { create: dto.priceTiers } : undefined,
        sizes: dto.sizes ? { create: dto.sizes } : undefined,
        options: dto.options ? { create: dto.options } : undefined,
        materials: dto.materials ? { create: dto.materials } : undefined,
      },
      include: {
        priceTiers: true,
        sizes: true,
        options: true,
        category: true,
        materials: { include: { product: { include: { unit: true } } } },
      },
    });
  }

  // Обновить услугу (скаляры; тиры/размеры/опции — заменяем, если переданы)
  async update(id: string, dto: Partial<CreateServiceDto>) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.priceTiers) {
        await tx.servicePriceTier.deleteMany({ where: { serviceId: id } });
      }
      if (dto.sizes) {
        await tx.serviceSize.deleteMany({ where: { serviceId: id } });
      }
      if (dto.options) {
        await tx.serviceOption.deleteMany({ where: { serviceId: id } });
      }
      return tx.service.update({
        where: { id },
        data: {
          name: dto.name,
          categoryId: dto.categoryId,
          pricingType: dto.pricingType,
          basePrice: dto.basePrice,
          costPrice: dto.costPrice,
          leadTimeMin: dto.leadTimeMin,
          designSurcharge: dto.designSurcharge,
          minQuantity: dto.minQuantity,
          imageUrl: dto.imageUrl,
          isActive: dto.isActive,
          priceTiers: dto.priceTiers ? { create: dto.priceTiers } : undefined,
          sizes: dto.sizes ? { create: dto.sizes } : undefined,
          options: dto.options ? { create: dto.options } : undefined,
        },
        include: {
          priceTiers: true,
          sizes: true,
          options: true,
          category: true,
          materials: { include: { product: { include: { unit: true } } } },
        },
      });
    });
  }

  // ---------- Категории услуг ----------
  createCategory(dto: { companyId: string; name: string }) {
    return this.prisma.serviceCategory.create({
      data: { companyId: dto.companyId, name: dto.name },
    });
  }

  findCategories(companyId: string) {
    return this.prisma.serviceCategory.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  // Переименовать / назначить категорию услуг по умолчанию (одна на компанию)
  async updateCategory(id: string, dto: { name?: string; isDefault?: boolean }) {
    const cat = await this.prisma.serviceCategory.findUniqueOrThrow({ where: { id } });
    if (dto.isDefault) {
      await this.prisma.serviceCategory.updateMany({
        where: { companyId: cat.companyId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return this.prisma.serviceCategory.update({
      where: { id },
      data: {
        name: dto.name?.trim() || undefined,
        isDefault: dto.isDefault,
      },
    });
  }

  // Удалить категорию: сначала открепляем услуги, чтобы не нарушать связь
  async removeCategory(id: string) {
    await this.prisma.service.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    });
    await this.prisma.serviceCategory.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Материалы услуги (спецификация для авто-списания) ----------
  async addMaterial(serviceId: string, productId: string, qtyPerUnit: number) {
    await this.findOne(serviceId);
    await this.prisma.serviceMaterial.upsert({
      where: { serviceId_productId: { serviceId, productId } },
      create: { serviceId, productId, qtyPerUnit, deletedAt: null },
      update: { qtyPerUnit, deletedAt: null },
    });
    return this.findOne(serviceId);
  }

  async removeMaterial(materialId: string) {
    await this.prisma.serviceMaterial.delete({ where: { id: materialId } });
    return { ok: true };
  }

  // Список услуг компании
  findAll(companyId: string) {
    return this.prisma.service.findMany({
      where: { companyId },
      include: {
        priceTiers: true,
        sizes: true,
        options: true,
        category: true,
        materials: { include: { product: { include: { unit: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Одна услуга по id
  async findOne(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        priceTiers: true,
        sizes: true,
        options: true,
        category: true,
        materials: { include: { product: { include: { unit: true } } } },
      },
    });
    if (!service) throw new NotFoundException('Услуга не найдена');
    return service;
  }

  // Удалить услугу
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.service.delete({ where: { id } });
  }
}
