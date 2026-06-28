import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateUnitDto } from './dto/create-unit.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Товары ----------
  createProduct(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        categoryId: dto.categoryId,
        unitId: dto.unitId,
        salePrice: dto.salePrice ?? 0,
        minStock: dto.minStock ?? 0,
        barcode: dto.barcode,
        isActive: dto.isActive ?? true,
      },
      include: { category: true, unit: true },
    });
  }

  findAllProducts(companyId: string) {
    return this.prisma.product.findMany({
      where: { companyId },
      include: { category: true, unit: true, stock: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOneProduct(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { category: true, unit: true, stock: { include: { branch: true } } },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return product;
  }

  // ---------- Категории товаров ----------
  createCategory(dto: CreateCategoryDto) {
    return this.prisma.productCategory.create({ data: dto });
  }

  findCategories(companyId: string) {
    return this.prisma.productCategory.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  // Удалить категорию: сначала открепляем товары, чтобы не нарушать связь
  async removeCategory(id: string) {
    await this.prisma.product.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    });
    await this.prisma.productCategory.delete({ where: { id } });
    return { ok: true };
  }

  async updateProduct(id: string, dto: Partial<CreateProductDto>) {
    await this.prisma.product.findUniqueOrThrow({ where: { id } });
    return this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        categoryId: dto.categoryId ?? null,
        unitId: dto.unitId ?? null,
        salePrice: dto.salePrice,
        minStock: dto.minStock,
        barcode: dto.barcode,
        isActive: dto.isActive,
      },
      include: { category: true, unit: true },
    });
  }

  async removeProduct(id: string) {
    await this.prisma.product.findUniqueOrThrow({ where: { id } });
    return this.prisma.product.delete({ where: { id } });
  }

  // ---------- Единицы измерения ----------
  createUnit(dto: CreateUnitDto) {
    return this.prisma.unit.create({ data: dto });
  }

  findUnits(companyId: string) {
    return this.prisma.unit.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  async removeUnit(id: string) {
    await this.prisma.unit.findUniqueOrThrow({ where: { id } });
    return this.prisma.unit.delete({ where: { id } });
  }
}
