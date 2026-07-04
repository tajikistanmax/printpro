import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { StockService } from './stock.service';
import { TransferStockDto } from './dto/transfer-stock.dto';
import { WriteOffDto } from './dto/write-off.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

// companyId во всех операциях склада берём из токена, а не из тела/query —
// иначе пользователь одной компании мог бы читать/двигать остатки другой.
// Права: просмотр — stock.view, мутации — stock.manage (кассир не спишет товар).
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
  @RequirePermissions('stock.manage')
  writeOff(@Body() dto: WriteOffDto, @CurrentUser() user: JwtUser) {
    return this.stock.writeOff({ ...dto, companyId: user.companyId });
  }

  // POST /api/stock/write-offs/:id/cancel — отмена (сторно) списания
  @Post('write-offs/:id/cancel')
  @RequirePermissions('stock.manage')
  cancelWriteOff(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.stock.cancelWriteOff(id, user.companyId, user.sub);
  }

  // GET /api/stock/write-offs — журнал списаний
  @Get('write-offs')
  @RequirePermissions('stock.view')
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

  // Мёртвые эндпоинты /stock/receive, /stock/adjust, /stock/recount удалены:
  // они меняли остаток без документов, UI их не вызывает. Приход — через
  // «Закупки» (/purchasing/receipts), инвентаризация — /stock/recount-bulk.

  // POST /api/stock/transfer — перемещение между филиалами
  @Post('transfer')
  @RequirePermissions('stock.manage')
  transfer(@Body() dto: TransferStockDto, @CurrentUser() user: JwtUser) {
    return this.stock.transfer({ ...dto, companyId: user.companyId });
  }

  // POST /api/stock/recount-bulk — массовая инвентаризация (лист по филиалу)
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

  // GET /api/stock — текущие остатки
  @Get()
  @RequirePermissions('stock.view')
  listStock(@CurrentUser() user: JwtUser) {
    return this.stock.listStock(user.companyId);
  }

  // GET /api/stock/low — оповещение о нехватке
  @Get('low')
  @RequirePermissions('stock.view')
  lowStock(@CurrentUser() user: JwtUser) {
    return this.stock.lowStock(user.companyId);
  }

  // GET /api/stock/movements — история движений (пагинация + фильтры)
  @Get('movements')
  @RequirePermissions('stock.view')
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
  @RequirePermissions('stock.view')
  stats(@CurrentUser() user: JwtUser) {
    return this.stock.stats(user.companyId);
  }
}
