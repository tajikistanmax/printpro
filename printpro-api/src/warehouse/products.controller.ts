import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

// companyId берём из токена, не из тела/query — иначе можно работать с каталогом
// чужой компании. Права: чтение — stock.view (нужно кассе), мутации — stock.manage.
interface JwtUser {
  sub: string;
  companyId: string;
}

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // ---- Товары ----
  @Post('products')
  @RequirePermissions('stock.manage', 'products.manage')
  createProduct(@Body() dto: CreateProductDto, @CurrentUser() user: JwtUser) {
    return this.products.createProduct({ ...dto, companyId: user.companyId });
  }

  // Каталог нужен и складу, и кассе (POS продаёт товары)
  @Get('products')
  @RequirePermissions('stock.view', 'products.view', 'cash.operate')
  findAllProducts(@CurrentUser() user: JwtUser) {
    return this.products.findAllProducts(user.companyId);
  }

  // Сгенерировать свободный штрихкод для нового товара
  @Get('products/generate-barcode')
  @RequirePermissions('stock.manage', 'products.manage')
  generateBarcode(@CurrentUser() user: JwtUser) {
    return this.products.generateBarcode(user.companyId);
  }

  // Импорт каталога из CSV/Excel (массив строк)
  @Post('products/import')
  @RequirePermissions('stock.manage', 'products.manage')
  importProducts(
    @CurrentUser() user: JwtUser,
    @Body() body: { rows: Array<Record<string, any>> },
  ) {
    return this.products.importProducts(user.companyId, body.rows ?? []);
  }

  @Get('products/:id')
  @RequirePermissions('stock.view', 'products.view', 'cash.operate')
  findOneProduct(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.products.findOneProduct(id, user.companyId);
  }

  @Patch('products/:id')
  @RequirePermissions('stock.manage', 'products.manage')
  updateProduct(
    @Param('id') id: string,
    @Body() dto: Partial<CreateProductDto>,
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.updateProduct(id, dto, user.companyId);
  }

  @Delete('products/:id')
  @RequirePermissions('stock.manage', 'products.manage')
  removeProduct(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.products.removeProduct(id, user.companyId);
  }

  // ---- Доп. штрихкоды (алиасы) ----
  @Post('products/:id/barcode-aliases')
  @RequirePermissions('stock.manage', 'products.manage')
  addBarcodeAlias(
    @Param('id') id: string,
    @Body() body: { barcode: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.addBarcodeAlias(id, body.barcode, user.companyId);
  }

  @Delete('products/barcode-aliases/:aliasId')
  @RequirePermissions('stock.manage', 'products.manage')
  removeBarcodeAlias(
    @Param('aliasId') aliasId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.removeBarcodeAlias(aliasId, user.companyId);
  }

  // ---- Категории товаров ----
  @Post('product-categories')
  @RequirePermissions('stock.manage', 'products.manage')
  createCategory(@Body() dto: CreateCategoryDto, @CurrentUser() user: JwtUser) {
    return this.products.createCategory({ ...dto, companyId: user.companyId });
  }

  @Get('product-categories')
  @RequirePermissions('stock.view', 'products.view', 'cash.operate')
  findCategories(@CurrentUser() user: JwtUser) {
    return this.products.findCategories(user.companyId);
  }

  @Patch('product-categories/:id')
  @RequirePermissions('stock.manage', 'products.manage')
  updateCategory(
    @Param('id') id: string,
    @Body() dto: { name?: string; isDefault?: boolean; parentId?: string | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.updateCategory(id, dto, user.companyId);
  }

  @Delete('product-categories/:id')
  @RequirePermissions('stock.manage', 'products.manage')
  removeCategory(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.products.removeCategory(id, user.companyId);
  }

  // ---- Единицы измерения ----
  @Post('units')
  @RequirePermissions('stock.manage', 'products.manage')
  createUnit(@Body() dto: CreateUnitDto, @CurrentUser() user: JwtUser) {
    return this.products.createUnit({ ...dto, companyId: user.companyId });
  }

  @Get('units')
  @RequirePermissions('stock.view', 'products.view', 'settings.manage')
  findUnits(@CurrentUser() user: JwtUser) {
    return this.products.findUnits(user.companyId);
  }

  @Patch('units/:id')
  @RequirePermissions('stock.manage', 'products.manage')
  updateUnit(
    @Param('id') id: string,
    @Body() dto: { name?: string; shortName?: string; isDefault?: boolean },
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.updateUnit(id, dto, user.companyId);
  }

  @Delete('units/:id')
  @RequirePermissions('stock.manage', 'products.manage')
  removeUnit(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.products.removeUnit(id, user.companyId);
  }
}
