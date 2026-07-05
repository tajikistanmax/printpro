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
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { ProductsService } from './products.service';

interface JwtUser {
  sub: string;
  companyId: string;
}

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post('products')
  @RequirePermissions('stock.manage')
  createProduct(@Body() dto: CreateProductDto, @CurrentUser() user: JwtUser) {
    return this.products.createProduct({ ...dto, companyId: user.companyId });
  }

  @Get('products')
  @RequirePermissions('stock.view')
  findAllProducts(@CurrentUser() user: JwtUser) {
    return this.products.findAllProducts(user.companyId);
  }

  @Get('products/generate-barcode')
  @RequirePermissions('stock.manage')
  generateBarcode(@CurrentUser() user: JwtUser) {
    return this.products.generateBarcode(user.companyId);
  }

  @Post('products/import')
  @RequirePermissions('stock.manage')
  importProducts(
    @CurrentUser() user: JwtUser,
    @Body() body: { rows: Array<Record<string, any>> },
  ) {
    return this.products.importProducts(user.companyId, body.rows ?? []);
  }

  @Get('products/:id')
  @RequirePermissions('stock.view')
  findOneProduct(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.products.findOneProduct(id, user.companyId);
  }

  @Patch('products/:id')
  @RequirePermissions('stock.manage')
  updateProduct(
    @Param('id') id: string,
    @Body() dto: Partial<CreateProductDto>,
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.updateProduct(id, dto, user.companyId);
  }

  @Delete('products/:id')
  @RequirePermissions('stock.manage')
  removeProduct(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.products.removeProduct(id, user.companyId);
  }

  @Post('products/:id/barcode-aliases')
  @RequirePermissions('stock.manage')
  addBarcodeAlias(
    @Param('id') id: string,
    @Body() body: { barcode: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.addBarcodeAlias(id, body.barcode, user.companyId);
  }

  @Delete('products/barcode-aliases/:aliasId')
  @RequirePermissions('stock.manage')
  removeBarcodeAlias(
    @Param('aliasId') aliasId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.removeBarcodeAlias(aliasId, user.companyId);
  }

  @Post('product-categories')
  @RequirePermissions('stock.manage')
  createCategory(@Body() dto: CreateCategoryDto, @CurrentUser() user: JwtUser) {
    return this.products.createCategory({ ...dto, companyId: user.companyId });
  }

  @Get('product-categories')
  @RequirePermissions('stock.view')
  findCategories(@CurrentUser() user: JwtUser) {
    return this.products.findCategories(user.companyId);
  }

  @Patch('product-categories/:id')
  @RequirePermissions('stock.manage')
  updateCategory(
    @Param('id') id: string,
    @Body() dto: { name?: string; isDefault?: boolean; parentId?: string | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.updateCategory(id, dto, user.companyId);
  }

  @Delete('product-categories/:id')
  @RequirePermissions('stock.manage')
  removeCategory(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.products.removeCategory(id, user.companyId);
  }

  @Post('units')
  @RequirePermissions('stock.manage')
  createUnit(@Body() dto: CreateUnitDto, @CurrentUser() user: JwtUser) {
    return this.products.createUnit({ ...dto, companyId: user.companyId });
  }

  @Get('units')
  @RequirePermissions('stock.view')
  findUnits(@CurrentUser() user: JwtUser) {
    return this.products.findUnits(user.companyId);
  }

  @Patch('units/:id')
  @RequirePermissions('stock.manage')
  updateUnit(
    @Param('id') id: string,
    @Body() dto: { name?: string; shortName?: string; isDefault?: boolean },
    @CurrentUser() user: JwtUser,
  ) {
    return this.products.updateUnit(id, dto, user.companyId);
  }

  @Delete('units/:id')
  @RequirePermissions('stock.manage')
  removeUnit(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.products.removeUnit(id, user.companyId);
  }
}
