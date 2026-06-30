import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateUnitDto } from './dto/create-unit.dto';

@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // ---- Товары ----
  @Post('products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.products.createProduct(dto);
  }

  @Get('products')
  findAllProducts(@Query('companyId') companyId: string) {
    return this.products.findAllProducts(companyId);
  }

  // Импорт каталога из CSV/Excel (массив строк)
  @Post('products/import')
  importProducts(
    @Body() body: { companyId: string; rows: Array<Record<string, any>> },
  ) {
    return this.products.importProducts(body.companyId, body.rows ?? []);
  }

  @Get('products/:id')
  findOneProduct(@Param('id') id: string) {
    return this.products.findOneProduct(id);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: Partial<CreateProductDto>) {
    return this.products.updateProduct(id, dto);
  }

  @Delete('products/:id')
  removeProduct(@Param('id') id: string) {
    return this.products.removeProduct(id);
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
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.products.createCategory(dto);
  }

  @Get('product-categories')
  findCategories(@Query('companyId') companyId: string) {
    return this.products.findCategories(companyId);
  }

  @Delete('product-categories/:id')
  removeCategory(@Param('id') id: string) {
    return this.products.removeCategory(id);
  }

  // ---- Единицы измерения ----
  @Post('units')
  createUnit(@Body() dto: CreateUnitDto) {
    return this.products.createUnit(dto);
  }

  @Get('units')
  findUnits(@Query('companyId') companyId: string) {
    return this.products.findUnits(companyId);
  }

  @Delete('units/:id')
  removeUnit(@Param('id') id: string) {
    return this.products.removeUnit(id);
  }
}
