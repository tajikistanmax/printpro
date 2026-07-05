import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureCategory(
    categoryId: string | null | undefined,
    companyId: string,
  ) {
    if (!categoryId) return;
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id: categoryId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Категория услуги не найдена');
  }

  private async ensureProduct(productId: string, companyId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Материал не найден');
  }

  async create(dto: CreateServiceDto & { companyId: string }) {
    await this.ensureCategory(dto.categoryId, dto.companyId);
    for (const material of dto.materials ?? []) {
      await this.ensureProduct(material.productId, dto.companyId);
    }

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
      include: this.includes(),
    });
  }

  async update(
    id: string,
    companyId: string,
    dto: Partial<CreateServiceDto>,
  ) {
    await this.findOne(id, companyId);
    await this.ensureCategory(dto.categoryId, companyId);

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
        include: this.includes(),
      });
    });
  }

  async createCategory(dto: {
    companyId: string;
    name: string;
    parentId?: string;
  }) {
    await this.ensureCategory(dto.parentId, dto.companyId);
    return this.prisma.serviceCategory.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        parentId: dto.parentId || undefined,
      },
    });
  }

  findCategories(companyId: string) {
    return this.prisma.serviceCategory.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async updateCategory(
    id: string,
    companyId: string,
    dto: { name?: string; isDefault?: boolean; parentId?: string | null },
  ) {
    const cat = await this.prisma.serviceCategory.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!cat) throw new NotFoundException('Категория услуги не найдена');

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
      const parentId = dto.parentId || null;
      if (parentId === id) {
        throw new BadRequestException('Категория не может быть своим родителем');
      }
      await this.ensureCategory(parentId, companyId);
      data.parentId = parentId;
    }

    return this.prisma.serviceCategory.update({ where: { id }, data });
  }

  async removeCategory(id: string, companyId: string) {
    const cat = await this.prisma.serviceCategory.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!cat) throw new NotFoundException('Категория услуги не найдена');

    await this.prisma.service.updateMany({
      where: { companyId, categoryId: id },
      data: { categoryId: null },
    });
    await this.prisma.serviceCategory.delete({ where: { id } });
    return { ok: true };
  }

  async addMaterial(
    serviceId: string,
    companyId: string,
    productId: string,
    qtyPerUnit: number,
  ) {
    await this.findOne(serviceId, companyId);
    await this.ensureProduct(productId, companyId);
    await this.prisma.serviceMaterial.upsert({
      where: { serviceId_productId: { serviceId, productId } },
      create: { serviceId, productId, qtyPerUnit, deletedAt: null },
      update: { qtyPerUnit, deletedAt: null },
    });
    return this.findOne(serviceId, companyId);
  }

  async removeMaterial(materialId: string, companyId: string) {
    const material = await this.prisma.serviceMaterial.findFirst({
      where: { id: materialId, service: { companyId } },
      select: { id: true },
    });
    if (!material) throw new NotFoundException('Материал услуги не найден');

    await this.prisma.serviceMaterial.delete({ where: { id: materialId } });
    return { ok: true };
  }

  findAll(companyId: string) {
    return this.prisma.service.findMany({
      where: { companyId, deletedAt: null },
      include: this.includes(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId?: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, deletedAt: null, ...(companyId ? { companyId } : {}) },
      include: this.includes(),
    });
    if (!service) throw new NotFoundException('Услуга не найдена');
    return service;
  }

  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.service.delete({ where: { id } });
  }

  private includes() {
    return {
      priceTiers: true,
      sizes: true,
      options: true,
      category: true,
      materials: { include: { product: { include: { unit: true } } } },
    };
  }
}
