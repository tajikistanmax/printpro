import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateUnitDto } from './dto/create-unit.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // Гонка на уникальном штрихкоде (частичный индекс
  // Product_companyId_barcode_active_key) → понятная ошибка вместо 500.
  private barcodeConflict(e: unknown, code?: string | null): never {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new BadRequestException(
        `Штрихкод ${(code ?? '').trim()} уже используется другим товаром`,
      );
    }
    throw e as Error;
  }

  // Проверка, что штрихкод свободен в пределах компании (среди активных
  // товаров и их доп. штрихкодов). Один штрихкод = один товар.
  private async assertBarcodeFree(
    companyId: string,
    barcode: string | null | undefined,
    exceptProductId?: string,
  ) {
    const code = (barcode ?? '').trim();
    if (!code) return;
    const notSelf = exceptProductId ? { id: { not: exceptProductId } } : {};
    const prod = await this.prisma.product.findFirst({
      where: { companyId, barcode: code, deletedAt: null, ...notSelf },
      select: { name: true },
    });
    if (prod)
      throw new BadRequestException(
        `Штрихкод ${code} уже используется товаром «${prod.name}»`,
      );
    const alias = await this.prisma.productBarcodeAlias.findFirst({
      where: {
        barcode: code,
        product: { companyId, deletedAt: null, ...notSelf },
      },
      select: { product: { select: { name: true } } },
    });
    if (alias)
      throw new BadRequestException(
        `Штрихкод ${code} уже используется товаром «${alias.product.name}» (доп. код)`,
      );
  }

  // ---------- Товары ----------
  private async assertCategory(companyId: string, categoryId?: string | null) {
    if (!categoryId) return;
    const category = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Category not found');
  }

  private async assertUnit(companyId: string, unitId?: string | null) {
    if (!unitId) return;
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!unit) throw new NotFoundException('Unit not found');
  }

  async createProduct(dto: CreateProductDto) {
    await this.assertCategory(dto.companyId, dto.categoryId);
    await this.assertUnit(dto.companyId, dto.unitId);
    // Нормализуем штрихкод один раз (trim) и храним триммнутое значение — иначе
    // проверка уникальности (тримит) и хранение (сырое) расходятся: можно завести
    // дубль по факту и код с пробелами не сканируется на POS. (P0-6)
    const barcode = dto.barcode?.trim() || null;
    await this.assertBarcodeFree(dto.companyId, barcode);
    try {
      return await this.prisma.product.create({
        data: {
          companyId: dto.companyId,
          name: dto.name,
          categoryId: dto.categoryId || null,
          unitId: dto.unitId || null,
          salePrice: dto.salePrice ?? 0,
          purchasePrice: dto.purchasePrice ?? 0,
          minStock: dto.minStock ?? 0,
          barcode,
          sku: dto.sku,
          size: dto.size,
          weight: dto.weight,
          imageUrl: dto.imageUrl,
          isActive: dto.isActive ?? true,
        },
        include: { category: true, unit: true },
      });
    } catch (e) {
      this.barcodeConflict(e, barcode);
    }
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

  async findOneProduct(id: string, companyId?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        unit: true,
        stock: { include: { branch: true } },
        serviceMaterials: {
          include: { service: { select: { id: true, name: true } } },
        },
        barcodeAliases: {
          where: { deletedAt: null },
          select: { id: true, barcode: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    if (companyId && product.companyId !== companyId) {
      throw new NotFoundException('Товар не найден');
    }

    // Последняя закупка (поставщик, дата, цена)
    const lastItem = await this.prisma.stockReceiptItem.findFirst({
      where: { productId: id, deletedAt: null },
      orderBy: { receipt: { date: 'desc' } },
      include: {
        receipt: { include: { supplier: { select: { name: true } } } },
      },
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
    const stockTotal = product.stock.reduce(
      (s, r) => s + Number(r.quantity),
      0,
    );
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
  async importProducts(companyId: string, rows: Array<Record<string, any>>) {
    // Пустая/отсутствующая ячейка → undefined, чтобы при ОБНОВЛЕНИИ Prisma не
    // затирала существующее значение нулём (повторный импорт без ценовых колонок
    // раньше обнулял salePrice/purchasePrice/minStock). При CREATE undefined
    // берёт дефолт 0 из схемы. (P0-5)
    const num = (v: any) => {
      const s = String(v ?? '')
        .replace(/\s/g, '')
        .replace(',', '.');
      if (s === '') return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    };
    const str = (v: any) => {
      const s = String(v ?? '').trim();
      return s || undefined;
    };

    const cats = await this.prisma.productCategory.findMany({
      where: { companyId, deletedAt: null },
    });
    const units = await this.prisma.unit.findMany({
      where: { companyId, deletedAt: null },
    });
    // Кто уже владеет каким штрихкодом — чтобы не назначить один код двум товарам
    const usedBarcodes = new Map<string, string>(); // barcode -> productId
    const activeProducts = await this.prisma.product.findMany({
      where: { companyId, deletedAt: null, barcode: { not: null } },
      select: { id: true, barcode: true },
    });
    for (const p of activeProducts)
      if (p.barcode) usedBarcodes.set(p.barcode, p.id);
    const aliases = await this.prisma.productBarcodeAlias.findMany({
      where: { product: { companyId, deletedAt: null } },
      select: { barcode: true, productId: true },
    });
    for (const a of aliases) usedBarcodes.set(a.barcode, a.productId);
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

      try {
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
        // Если штрихкод уже занят другим товаром — не назначаем его (импорт не падает)
        if (data.barcode) {
          const owner = usedBarcodes.get(data.barcode);
          if (owner && owner !== existing?.id) data.barcode = undefined;
        }
        if (existing) {
          await this.prisma.product.update({
            where: { id: existing.id },
            data,
          });
          if (data.barcode) usedBarcodes.set(data.barcode, existing.id);
          updated++;
        } else {
          const p = await this.prisma.product.create({
            data: { companyId, ...data },
          });
          if (data.barcode) usedBarcodes.set(data.barcode, p.id);
          created++;
        }
      } catch {
        // Ошибка на строке (конфликт данных и т.п.) не должна рушить весь импорт
        skipped++;
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
  async addBarcodeAlias(
    productId: string,
    barcode: string,
    companyId?: string,
  ) {
    const code = (barcode ?? '').trim();
    if (!code) throw new NotFoundException('Пустой штрихкод');
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { companyId: true },
    });
    if (!product || (companyId && product.companyId !== companyId)) {
      throw new NotFoundException('Product not found');
    }
    // Не даём назначить чужой штрихкод (уже у другого товара или его доп. кода)
    await this.assertBarcodeFree(product.companyId, code, productId);
    try {
      return await this.prisma.productBarcodeAlias.create({
        data: { productId, barcode: code },
        select: { id: true, barcode: true },
      });
    } catch (e: unknown) {
      // Штрихкод доп. кодов уникален глобально — понятная ошибка вместо 500.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(`Штрихкод ${code} уже используется`);
      }
      throw e;
    }
  }

  async removeBarcodeAlias(aliasId: string, companyId?: string) {
    const alias = await this.prisma.productBarcodeAlias.findFirst({
      where: {
        id: aliasId,
        ...(companyId ? { product: { companyId } } : {}),
      },
      select: { id: true },
    });
    if (!alias) throw new NotFoundException('Barcode alias not found');
    await this.prisma.productBarcodeAlias.delete({ where: { id: aliasId } });
    return { ok: true };
  }

  // ---------- Категории товаров ----------
  async createCategory(dto: CreateCategoryDto) {
    await this.assertCategory(dto.companyId, dto.parentId);
    return this.prisma.productCategory.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        parentId: dto.parentId || undefined, // пусто → верхний уровень
      },
    });
  }

  findCategories(companyId: string) {
    return this.prisma.productCategory.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  // Переименовать / назначить по умолчанию / сменить родителя (подкатегория)
  async updateCategory(
    id: string,
    dto: { name?: string; isDefault?: boolean; parentId?: string | null },
    companyId?: string,
  ) {
    const cat = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!cat || cat.deletedAt || (companyId && cat.companyId !== companyId)) {
      throw new NotFoundException('Category not found');
    }
    if (dto.isDefault) {
      await this.prisma.productCategory.updateMany({
        where: { companyId: cat.companyId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const data: {
      name?: string;
      isDefault?: boolean;
      parentId?: string | null;
    } = {
      name: dto.name?.trim() || undefined,
      isDefault: dto.isDefault,
    };
    if (dto.parentId !== undefined) {
      const pid = dto.parentId || null;
      if (pid === id) {
        throw new BadRequestException(
          'Категория не может быть своим родителем',
        );
      }
      await this.assertCategory(cat.companyId, pid);
      // Защита от циклов в дереве категорий. Прямого self-parent мало: цепочка
      // A→B→C с назначением A.parent=C тоже замыкает цикл. Поднимаемся по
      // родителям нового родителя; если встретили саму категорию — отклоняем.
      // visited страхует от зацикливания на уже повреждённых данных.
      if (pid) {
        const visited = new Set<string>([id]);
        let cursor: string | null = pid;
        while (cursor) {
          if (visited.has(cursor)) {
            throw new BadRequestException(
              'Нельзя переместить категорию внутрь её же подкатегории (цикл)',
            );
          }
          visited.add(cursor);
          const parent: { parentId: string | null } | null =
            await this.prisma.productCategory.findUnique({
              where: { id: cursor },
              select: { parentId: true },
            });
          cursor = parent?.parentId ?? null;
        }
      }
      data.parentId = pid;
    }
    return this.prisma.productCategory.update({ where: { id }, data });
  }

  // Удалить категорию (мягко, в транзакции):
  //  1) открепляем товары этой категории (categoryId → null);
  //  2) подкатегории поднимаем на верхний уровень (parentId → null), чтобы они
  //     и их товары не «повисли» на удалённом родителе;
  //  3) мягкое удаление (deletedAt) — в духе soft-delete/синхронизации,
  //     hard delete ломал бы историю и sync.
  async removeCategory(id: string, companyId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const cat = await tx.productCategory.findUnique({ where: { id } });
      if (!cat || cat.deletedAt) {
        throw new NotFoundException('Категория не найдена');
      }
      if (companyId && cat.companyId !== companyId) {
        throw new NotFoundException('Категория не найдена');
      }
      await tx.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
      });
      await tx.productCategory.updateMany({
        where: { parentId: id },
        data: { parentId: null },
      });
      await tx.productCategory.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      return { ok: true };
    });
  }

  async updateProduct(
    id: string,
    dto: Partial<CreateProductDto>,
    companyId?: string,
  ) {
    const current = await this.prisma.product.findUnique({ where: { id } });
    if (
      !current ||
      current.deletedAt ||
      (companyId && current.companyId !== companyId)
    ) {
      throw new NotFoundException('Товар не найден');
    }
    await this.assertCategory(current.companyId, dto.categoryId);
    await this.assertUnit(current.companyId, dto.unitId);
    if (dto.barcode != null && dto.barcode.trim() !== (current.barcode ?? '')) {
      await this.assertBarcodeFree(current.companyId, dto.barcode, id);
    }
    try {
      return await this.prisma.product.update({
        where: { id },
        data: {
          name: dto.name,
          // Не сбрасываем категорию/единицу при частичном обновлении: поле, которого
          // нет в запросе (undefined), Prisma пропускает; пустая строка → снять связь.
          categoryId:
            dto.categoryId === undefined ? undefined : dto.categoryId || null,
          unitId: dto.unitId === undefined ? undefined : dto.unitId || null,
          salePrice: dto.salePrice,
          purchasePrice: dto.purchasePrice,
          minStock: dto.minStock,
          // Храним триммнутый штрихкод (P0-6); undefined → поле не трогаем,
          // пустая строка → снять штрихкод (null).
          barcode:
            dto.barcode === undefined ? undefined : dto.barcode.trim() || null,
          sku: dto.sku,
          size: dto.size,
          weight: dto.weight,
          imageUrl: dto.imageUrl,
          isActive: dto.isActive,
        },
        include: { category: true, unit: true },
      });
    } catch (e) {
      this.barcodeConflict(e, dto.barcode);
    }
  }

  async removeProduct(id: string, companyId?: string) {
    const current = await this.prisma.product.findUnique({ where: { id } });
    if (
      !current ||
      current.deletedAt ||
      (companyId && current.companyId !== companyId)
    ) {
      throw new NotFoundException('Товар не найден');
    }
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
    return this.prisma.unit.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  // Переименовать / назначить единицу по умолчанию (одна на компанию)
  async updateUnit(
    id: string,
    dto: { name?: string; shortName?: string; isDefault?: boolean },
    companyId?: string,
  ) {
    const u = await this.prisma.unit.findUnique({ where: { id } });
    if (!u || u.deletedAt || (companyId && u.companyId !== companyId)) {
      throw new NotFoundException('Unit not found');
    }
    if (dto.isDefault) {
      await this.prisma.unit.updateMany({
        where: { companyId: u.companyId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return this.prisma.unit.update({
      where: { id },
      data: {
        name: dto.name?.trim() || undefined,
        shortName: dto.shortName?.trim() || undefined,
        isDefault: dto.isDefault,
      },
    });
  }

  async removeUnit(id: string, companyId?: string) {
    const unit = await this.prisma.unit.findUnique({ where: { id } });
    if (
      !unit ||
      unit.deletedAt ||
      (companyId && unit.companyId !== companyId)
    ) {
      throw new NotFoundException('Unit not found');
    }
    // Единица используется активными товарами — не удаляем. Хард-delete через
    // FK (onDelete: SetNull) молча обнулил бы unitId у всех этих товаров;
    // сначала переназначьте товары на другую единицу.
    const inUse = await this.prisma.product.count({
      where: { unitId: id, companyId: unit.companyId, deletedAt: null },
    });
    if (inUse > 0) {
      throw new BadRequestException(
        `Единица используется в ${inUse} товар(ах) — сначала переназначьте их на другую единицу`,
      );
    }
    // Мягкое удаление (soft-delete/синхронизация), а не хард-delete: сохраняем
    // историю и корректный sync-tombstone.
    return this.prisma.unit.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
