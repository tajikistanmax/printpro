import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import {
  CreateReceiptDto,
  CreateSupplierDto,
  UpdateSupplierDto,
  PaySupplierDebtDto,
  CreatePurchaseRequestDto,
} from './dto/purchasing.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('purchasing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  // ----- Поставщики -----
  // companyId — из токена; операции по :id проверяют владельца в сервисе.
  @Get('suppliers')
  @RequirePermissions('stock.view')
  listSuppliers(@CurrentUser() user: { companyId: string }) {
    return this.purchasing.listSuppliers(user.companyId);
  }

  @Post('suppliers')
  @RequirePermissions('stock.manage')
  createSupplier(
    @Body() dto: CreateSupplierDto,
    @CurrentUser() user: { companyId: string },
  ) {
    return this.purchasing.createSupplier({ ...dto, companyId: user.companyId });
  }

  @Patch('suppliers/:id')
  @RequirePermissions('stock.manage')
  updateSupplier(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: { companyId: string },
  ) {
    return this.purchasing.updateSupplier(id, dto, user.companyId);
  }

  @Post('suppliers/:id/pay-debt')
  @RequirePermissions('stock.manage')
  paySupplierDebt(
    @Param('id') id: string,
    @Body() dto: PaySupplierDebtDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.purchasing.paySupplierDebt(id, dto, user.sub, user.companyId);
  }

  // ----- Приёмка -----
  @Get('receipts')
  @RequirePermissions('stock.view')
  listReceipts(@CurrentUser() user: { companyId: string }) {
    return this.purchasing.listReceipts(user.companyId);
  }

  @Get('receipts/:id')
  @RequirePermissions('stock.view')
  findReceipt(@Param('id') id: string, @CurrentUser() user: { companyId: string }) {
    return this.purchasing.findReceipt(id, user.companyId);
  }

  @Post('receipts')
  @RequirePermissions('stock.manage')
  createReceipt(
    @Body() dto: CreateReceiptDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.purchasing.createReceipt(
      { ...dto, companyId: user.companyId },
      user.sub,
    );
  }

  // Отмена (сторно) ошибочной приёмки
  @Post('receipts/:id/cancel')
  @RequirePermissions('stock.manage')
  cancelReceipt(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.purchasing.cancelReceipt(id, user.companyId, user.sub);
  }

  // ----- Заявки на закупку -----
  @Get('requests')
  @RequirePermissions('stock.view')
  listRequests(@CurrentUser() user: { companyId: string }) {
    return this.purchasing.listRequests(user.companyId);
  }

  @Post('requests')
  @RequirePermissions('stock.manage')
  createRequest(
    @Body() dto: CreatePurchaseRequestDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.purchasing.createRequest(
      { ...dto, companyId: user.companyId },
      user.sub,
    );
  }
}
