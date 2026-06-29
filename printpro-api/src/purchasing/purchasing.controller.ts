import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import {
  CreateReceiptDto,
  CreateSupplierDto,
  UpdateSupplierDto,
  PaySupplierDebtDto,
} from './dto/purchasing.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';

@Controller('purchasing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  // ----- Поставщики -----
  @Get('suppliers')
  @RequirePermissions('stock.view')
  listSuppliers(@Query('companyId') companyId: string) {
    return this.purchasing.listSuppliers(companyId);
  }

  @Post('suppliers')
  @RequirePermissions('stock.manage')
  createSupplier(@Body() dto: CreateSupplierDto) {
    return this.purchasing.createSupplier(dto);
  }

  @Patch('suppliers/:id')
  @RequirePermissions('stock.manage')
  updateSupplier(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.purchasing.updateSupplier(id, dto);
  }

  @Post('suppliers/:id/pay-debt')
  @RequirePermissions('stock.manage')
  paySupplierDebt(@Param('id') id: string, @Body() dto: PaySupplierDebtDto) {
    return this.purchasing.paySupplierDebt(id, dto);
  }

  // ----- Приёмка -----
  @Get('receipts')
  @RequirePermissions('stock.view')
  listReceipts(@Query('companyId') companyId: string) {
    return this.purchasing.listReceipts(companyId);
  }

  @Get('receipts/:id')
  @RequirePermissions('stock.view')
  findReceipt(@Param('id') id: string) {
    return this.purchasing.findReceipt(id);
  }

  @Post('receipts')
  @RequirePermissions('stock.manage')
  createReceipt(@Body() dto: CreateReceiptDto) {
    return this.purchasing.createReceipt(dto);
  }
}
