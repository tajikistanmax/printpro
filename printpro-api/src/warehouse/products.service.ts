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
        purchasePrice: dto.purchasePrice ?? 0,
        minStock: dto.minStock ?? 0,
        barcode: dto.barcode,
        sku: dto.sku,
        size: dto.size,
        weight: dto.weight,
        imageUrl: dto.imageUrl,
        isActive: dto.isActive ?? true,
      },
      include: { category: true, unit: true },
    });
  }

  findAllProducts(companyId: string) {
    return this.prisma.product.findMany({
      where: { companyId, deletedAt: null },
      include: {
        category: true,
        unit: true,
        stock: { include: { branch: { select: { name: true } } } },
        barcodeAliases: {
          where: { deletedAt: null },
          select: { id: true, barcode: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOneProduct(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        unit: true,
        stock: { include: { branch: true } },
        serviceMaterials: { include: { service: { select: { id: true, name: true } } } },
        barcodeAliases: {
          where: { deletedAt: null },
          select: { id: true, barcode: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    // Последняя закупка (поставщик, дата, цена)
    const lastItem = await this.prisma.stockReceiptItem.findFirst({
      where: { productId: id, deletedAt: null },
      orderBy: { receipt: { date: 'desc' } },
      include: { receipt: { include: { supplier: { select: { name: true } } } } },
    });
    const lastReceipt = lastItem
      ? {
          supplier: lastItem.receipt?.supplier?.name ?? null,
          date: lastItem.receipt?.date ?? null,
          cost: Number(lastItem.cost),
          quantity: Number(lastItem.quantity),
        }
      : null;

    // Средний расход за 30 дней (OUT + WRITE_OFF) и «хватит на N дней»
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const consumedAgg = await this.prisma.stockMovement.aggregate({
      where: {
        productId: id,
        type: { in: ['OUT', 'WRITE_OFF'] },
        createdAt: { gte: since },
      },
      _sum: { quantity: true },
    });
    const consumed = Number(consumedAgg._sum.quantity ?? 0);
    const avgPerDay = consumed > 0 ? Number((consumed / 30).toFixed(2)) : 0;
    const stockTotal = product.stock.reduce((s, r) => s + Number(r.quantity), 0);
    const daysLeft = avgPerDay > 0 ? Math.floor(stockTotal / avgPerDay) : null;

    return {
      ...product,
      stockTotal,
      usedInServices: product.serviceMaterials.map((m) => m.service),
      lastReceipt,
      consumption: { avgPerDay, daysLeft },
    };
  }

  // ---------- Импорт каталога (CSV/Excel) ----------
  // Принимает строки {name, category, unit, salePrice, purchasePrice, minStock, sku, barcode}.
  // Категории/единицы подбираются по имени (создаются при отсутствии).
  // Совпадение по имени товара (без учёта регистра) → обновляем, иначе создаём.
  async importProducts(
    companyId: string,
    rows: Array<Record<string, any>>,
  ) {
    const num = (v: any) => {
      const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    };
    const str = (v: any) => {
      const s = String(v ?? '').trim();
      return s || undefined;
    };

    const cats = await this.prisma.productCategory.findMany({
      where: { companyId, deletedAt: null },
    });
    const units = await this.prisma.unit.findMany({ where: { companyId } });
    const catMap = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
    const unitMap = new Map<string, string>();
    for (const u of units) {
      unitMap.set(u.name.toLowerCase(), u.id);
      if (u.shortName) unitMap.set(u.shortName.toLowerCase(), u.id);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) {
        skipped++;
        continue;
      }

      let categoryId: string | null = null;
      const catName = String(r.category ?? '').trim();
      if (catName) {
        const key = catName.toLowerCase();
        categoryId = catMap.get(key) ?? null;
        if (!categoryId) {
          const c = await this.prisma.productCategory.create({
            data: { companyId, name: catName },
          });
          categoryId = c.id;
          catMap.set(key, c.id);
        }
      }

      let unitId: string | null = null;
      const unitName = String(r.unit ?? '').trim();
      if (unitName) {
        const key = unitName.toLowerCase();
        unitId = unitMap.get(key) ?? null;
        if (!unitId) {
          const u = await this.prisma.unit.create({
            data: { companyId, name: unitName, shortName: unitName },
          });
          unitId = u.id;
          unitMap.set(key, u.id);
        }
      }

      const data = {
        name,
        categoryId,
        unitId,
        salePrice: num(r.salePrice ?? r.price),
        purchasePrice: num(r.purchasePrice),
        minStock: num(r.minStock),
        sku: str(r.sku),
        barcode: str(r.barcode),
      };

      const existing = await this.prisma.product.findFirst({
        where: {
          companyId,
          deletedAt: null,
          name: { equals: name, mode: 'insensitive' },
        },
      });
      if (existing) {
        await this.prisma.product.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await this.prisma.product.create({ data: { companyId, ...data } });
        created++;
      }
    }

    return { created, updated, skipped, total: rows.length };
  }

  // ---------- Генерация свободного штрихкода ----------
  // Внутренний EAN-13: префикс «2» (зарезервирован для внутреннего использования)
  // + 11 случайных цифр + контрольная цифра. Проверяем уникальность по каталогу.
  async generateBarcode(companyId: string) {
    const checkDigit = (d12: string) => {
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        const n = d12.charCodeAt(i) - 48;
        sum += i % 2 === 0 ? n : n * 3;
      }
      return String((10 - (sum % 10)) % 10);
    };

    for (let attempt = 0; attempt < 30; attempt++) {
      let base = '2';
      for (let i = 0; i < 11; i++) base += Math.floor(Math.random() * 10);
      const code = base + checkDigit(base);

      const [usedProduct, usedAlias] = await Promise.all([
        this.prisma.product.findFirst({
          where: { companyId, barcode: code, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.productBarcodeAlias.findFirst({
          where: { barcode: code },
          select: { id: true },
        }),
      ]);
      if (!usedProduct && !usedAlias) return { barcode: code };
    }
    throw new NotFoundException('Не удалось сгенерировать свободный штрихкод');
  }

  // ---------- Доп. штрихкоды (алиасы) ----------
  async addBarcodeAlias(productId: string, barcode: string) {
    const code = (barcode ?? '').trim();
    if (!code) throw new NotFoundException('Пустой штрихкод');
    return this.prisma.productBarcodeAlias.create({
      data: { productId, barcode: code },
      select: { id: true, barcode: true },
    });
  }

  async removeBarcodeAlias(aliasId: string) {
    await this.prisma.productBarcodeAlias.delete({ where: { id: aliasId } });
    return { ok: true };
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
        purchasePrice: dto.purchasePrice,
        minStock: dto.minStock,
        barcode: dto.barcode,
        sku: dto.sku,
        size: dto.size,
        weight: dto.weight,
        imageUrl: dto.imageUrl,
        isActive: dto.isActive,
      },
      include: { category: true, unit: true },
    });
  }

  async removeProduct(id: string) {
    await this.prisma.product.findUniqueOrThrow({ where: { id } });
    // Мягкое удаление: сохраняем историю продаж/движений, но убираем из каталога
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
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
