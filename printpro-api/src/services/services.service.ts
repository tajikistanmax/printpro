import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
  async update(id: string, dto: Partial<CreateServiceDto>, companyId: string) {
    await this.findOne(id, companyId);
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
  createCategory(dto: { companyId: string; name: string; parentId?: string }) {
    return this.prisma.serviceCategory.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        parentId: dto.parentId || undefined, // пусто → верхний уровень
      },
    });
  }

  findCategories(companyId: string) {
    return this.prisma.serviceCategory.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  // Переименовать / по умолчанию / сменить родителя (подкатегория)
  async updateCategory(
    id: string,
    dto: { name?: string; isDefault?: boolean; parentId?: string | null },
    companyId: string,
  ) {
    const cat = await this.prisma.serviceCategory.findUniqueOrThrow({ where: { id } });
    if (cat.companyId !== companyId) {
      throw new NotFoundException('Категория не найдена');
    }
    if (dto.isDefault) {
      await this.prisma.serviceCategory.updateMany({
        where: { companyId: cat.companyId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const data: { name?: string; isDefault?: boolean; parentId?: string | null } = {
      name: dto.name?.trim() || undefined,
      isDefault: dto.isDefault,
    };
    if (dto.parentId !== undefined) {
      const pid = dto.parentId || null;
      if (pid === id) {
        throw new BadRequestException('Категория не может быть своим родителем');
      }
      data.parentId = pid;
    }
    return this.prisma.serviceCategory.update({ where: { id }, data });
  }

  // Удалить категорию: сначала открепляем услуги, чтобы не нарушать связь
  async removeCategory(id: string, companyId: string) {
    const cat = await this.prisma.serviceCategory.findUniqueOrThrow({ where: { id } });
    if (cat.companyId !== companyId) {
      throw new NotFoundException('Категория не найдена');
    }
    await this.prisma.service.updateMany({
      where: { categoryId: id, companyId },
      data: { categoryId: null },
    });
    await this.prisma.serviceCategory.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Материалы услуги (спецификация для авто-списания) ----------
  async addMaterial(
    serviceId: string,
    productId: string,
    qtyPerUnit: number,
    companyId: string,
  ) {
    await this.findOne(serviceId, companyId);
    await this.prisma.serviceMaterial.upsert({
      where: { serviceId_productId: { serviceId, productId } },
      create: { serviceId, productId, qtyPerUnit, deletedAt: null },
      update: { qtyPerUnit, deletedAt: null },
    });
    return this.findOne(serviceId, companyId);
  }

  async removeMaterial(materialId: string, companyId: string) {
    // Убеждаемся, что материал принадлежит услуге нашей компании
    const material = await this.prisma.serviceMaterial.findUnique({
      where: { id: materialId },
      include: { service: { select: { companyId: true } } },
    });
    if (!material || material.service.companyId !== companyId) {
      throw new NotFoundException('Материал не найден');
    }
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

  // Одна услуга по id (в пределах своей компании)
  async findOne(id: string, companyId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, companyId },
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
  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.service.delete({ where: { id } });
  }
}
