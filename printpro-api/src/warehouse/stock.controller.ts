import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { StockService } from './stock.service';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto, RecountStockDto } from './dto/transfer-stock.dto';
import { WriteOffDto } from './dto/write-off.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// companyId во всех операциях склада берём из токена, а не из тела/query —
// иначе пользователь одной компании мог бы читать/двигать остатки другой.
interface JwtUser {
  sub: string;
  companyId: string;
}

@Controller('stock')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}

  // POST /api/stock/write-off — списание (бой/брак/порча)
  @Post('write-off')
  writeOff(@Body() dto: WriteOffDto, @CurrentUser() user: JwtUser) {
    return this.stock.writeOff({ ...dto, companyId: user.companyId });
  }

  // POST /api/stock/write-offs/:id/cancel — отмена (сторно) списания
  @Post('write-offs/:id/cancel')
  cancelWriteOff(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.stock.cancelWriteOff(id, user.companyId, user.sub);
  }

  // GET /api/stock/write-offs — журнал списаний
  @Get('write-offs')
  listWriteOffs(
    @CurrentUser() user: JwtUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.stock.listWriteOffs(user.companyId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  // POST /api/stock/receive — приём товара (приход)
  @Post('receive')
  receive(@Body() dto: ReceiveStockDto, @CurrentUser() user: JwtUser) {
    return this.stock.receive({ ...dto, companyId: user.companyId });
  }

  // POST /api/stock/adjust — списание / корректировка
  @Post('adjust')
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: JwtUser) {
    return this.stock.adjust({ ...dto, companyId: user.companyId });
  }

  // POST /api/stock/transfer — перемещение между филиалами
  @Post('transfer')
  transfer(@Body() dto: TransferStockDto, @CurrentUser() user: JwtUser) {
    return this.stock.transfer({ ...dto, companyId: user.companyId });
  }

  // POST /api/stock/recount — инвентаризация (фактический остаток)
  @Post('recount')
  recount(@Body() dto: RecountStockDto, @CurrentUser() user: JwtUser) {
    return this.stock.recount({ ...dto, companyId: user.companyId });
  }

  // POST /api/stock/recount-bulk — массовая инвентаризация (лист по филиалу)
  @Post('recount-bulk')
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

  // GET /api/stock — текущие остатки
  @Get()
  listStock(@CurrentUser() user: JwtUser) {
    return this.stock.listStock(user.companyId);
  }

  // GET /api/stock/low — оповещение о нехватке
  @Get('low')
  lowStock(@CurrentUser() user: JwtUser) {
    return this.stock.lowStock(user.companyId);
  }

  // GET /api/stock/movements — история движений (пагинация + фильтры)
  @Get('movements')
  listMovements(
    @CurrentUser() user: JwtUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('type') type?: StockMovementType,
    @Query('productId') productId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.stock.listMovements(user.companyId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      type,
      productId,
      from,
      to,
    });
  }

  // GET /api/stock/stats — сводка (поставщиков, поступления сегодня)
  @Get('stats')
  stats(@CurrentUser() user: JwtUser) {
    return this.stock.stats(user.companyId);
  }
}
