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
    return this.prisma.productCategory.findMany({ where: { companyId } });
  }

  // ---------- Единицы измерения ----------
  createUnit(dto: CreateUnitDto) {
    return this.prisma.unit.create({ data: dto });
  }

  findUnits(companyId: string) {
    return this.prisma.unit.findMany({ where: { companyId } });
  }
}
