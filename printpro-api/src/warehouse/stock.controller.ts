import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { StockService } from './stock.service';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto, RecountStockDto } from './dto/transfer-stock.dto';
import { WriteOffDto } from './dto/write-off.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';

interface JwtUser {
  sub: string;
  companyId: string;
}

@Controller('stock')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('write-off')
  @RequirePermissions('stock.manage')
  writeOff(@Body() dto: WriteOffDto, @CurrentUser() user: JwtUser) {
    return this.stock.writeOff({
      ...dto,
      companyId: user.companyId,
      userId: user.sub,
    });
  }

  @Get('write-offs')
  @RequirePermissions('stock.view')
  listWriteOffs(@CurrentUser() user: JwtUser) {
    return this.stock.listWriteOffs(user.companyId);
  }

  @Post('receive')
  @RequirePermissions('stock.manage')
  receive(@Body() dto: ReceiveStockDto, @CurrentUser() user: JwtUser) {
    return this.stock.receive({
      ...dto,
      companyId: user.companyId,
      userId: user.sub,
    });
  }

  @Post('adjust')
  @RequirePermissions('stock.manage')
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: JwtUser) {
    return this.stock.adjust({
      ...dto,
      companyId: user.companyId,
      userId: user.sub,
    });
  }

  @Post('transfer')
  @RequirePermissions('stock.manage')
  transfer(@Body() dto: TransferStockDto, @CurrentUser() user: JwtUser) {
    return this.stock.transfer({
      ...dto,
      companyId: user.companyId,
      userId: user.sub,
    });
  }

  @Post('recount')
  @RequirePermissions('stock.manage')
  recount(@Body() dto: RecountStockDto, @CurrentUser() user: JwtUser) {
    return this.stock.recount({
      ...dto,
      companyId: user.companyId,
      userId: user.sub,
    });
  }

  @Post('recount-bulk')
  @RequirePermissions('stock.manage')
  recountBulk(
    @CurrentUser() user: JwtUser,
    @Body()
    body: {
      branchId: string;
      items: Array<{ productId: string; countedQuantity: number }>;
    },
  ) {
    return this.stock.recountBulk(
      user.companyId,
      body.branchId,
      body.items ?? [],
      user.sub,
    );
  }

  @Get()
  @RequirePermissions('stock.view')
  listStock(@CurrentUser() user: JwtUser) {
    return this.stock.listStock(user.companyId);
  }

  @Get('low')
  @RequirePermissions('stock.view')
  lowStock(@CurrentUser() user: JwtUser) {
    return this.stock.lowStock(user.companyId);
  }

  @Get('movements')
  @RequirePermissions('stock.view')
  listMovements(@CurrentUser() user: JwtUser) {
    return this.stock.listMovements(user.companyId);
  }

  @Get('stats')
  @RequirePermissions('stock.view')
  stats(@CurrentUser() user: JwtUser) {
    return this.stock.stats(user.companyId);
  }
}
