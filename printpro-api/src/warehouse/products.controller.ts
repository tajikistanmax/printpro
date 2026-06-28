import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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

  @Get('products/:id')
  findOneProduct(@Param('id') id: string) {
    return this.products.findOneProduct(id);
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
}
