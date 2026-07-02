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
import { CurrentUser } from '../auth/current-user.decorator';

// companyId берём из токена, не из тела/query — иначе можно работать с каталогом
// чужой компании. (Проверка владельца по :id-товару — отдельная доработка.)
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
  createProduct(@Body() dto: CreateProductDto, @CurrentUser() user: JwtUser) {
    return this.products.createProduct({ ...dto, companyId: user.companyId });
  }

  @Get('products')
  findAllProducts(@CurrentUser() user: JwtUser) {
    return this.products.findAllProducts(user.companyId);
  }

  // Сгенерировать свободный штрихкод для нового товара
  @Get('products/generate-barcode')
  generateBarcode(@CurrentUser() user: JwtUser) {
    return this.products.generateBarcode(user.companyId);
  }

  // Импорт каталога из CSV/Excel (массив строк)
  @Post('products/import')
  importProducts(
    @CurrentUser() user: JwtUser,
    @Body() body: { rows: Array<Record<string, any>> },
  ) {
    return this.products.importProducts(user.companyId, body.rows ?? []);
  }

  @Get('products/:id')
  findOneProduct(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.products.findOneProduct(id, user.companyId);
  }

  @Patch('products/:id')
  updateProduct(
    @Param('id') id: string,
    @Body() dto: Partial<CreateProductDto>,
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.updateProduct(id, dto, user.companyId);
  }

  @Delete('products/:id')
  removeProduct(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.products.removeProduct(id, user.companyId);
  }

  // ---- Доп. штрихкоды (алиасы) ----
  @Post('products/:id/barcode-aliases')
  addBarcodeAlias(@Param('id') id: string, @Body() body: { barcode: string }) {
    return this.products.addBarcodeAlias(id, body.barcode);
  }

  @Delete('products/barcode-aliases/:aliasId')
  removeBarcodeAlias(@Param('aliasId') aliasId: string) {
    return this.products.removeBarcodeAlias(aliasId);
  }

  // ---- Категории товаров ----
  @Post('product-categories')
  createCategory(@Body() dto: CreateCategoryDto, @CurrentUser() user: JwtUser) {
    return this.products.createCategory({ ...dto, companyId: user.companyId });
  }

  @Get('product-categories')
  findCategories(@CurrentUser() user: JwtUser) {
    return this.products.findCategories(user.companyId);
  }

  @Patch('product-categories/:id')
  updateCategory(
    @Param('id') id: string,
    @Body() dto: { name?: string; isDefault?: boolean; parentId?: string | null },
  ) {
    return this.products.updateCategory(id, dto);
  }

  @Delete('product-categories/:id')
  removeCategory(@Param('id') id: string) {
    return this.products.removeCategory(id);
  }

  // ---- Единицы измерения ----
  @Post('units')
  createUnit(@Body() dto: CreateUnitDto, @CurrentUser() user: JwtUser) {
    return this.products.createUnit({ ...dto, companyId: user.companyId });
  }

  @Get('units')
  findUnits(@CurrentUser() user: JwtUser) {
    return this.products.findUnits(user.companyId);
  }

  @Patch('units/:id')
  updateUnit(
    @Param('id') id: string,
    @Body() dto: { name?: string; shortName?: string; isDefault?: boolean },
  ) {
    return this.products.updateUnit(id, dto);
  }

  @Delete('units/:id')
  removeUnit(@Param('id') id: string) {
    return this.products.removeUnit(id);
  }
}
