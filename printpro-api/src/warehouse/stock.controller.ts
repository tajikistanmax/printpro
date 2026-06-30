import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { StockService } from './stock.service';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto, RecountStockDto } from './dto/transfer-stock.dto';
import { WriteOffDto } from './dto/write-off.dto';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  // POST /api/stock/write-off — списание (бой/брак/порча)
  @Post('write-off')
  writeOff(@Body() dto: WriteOffDto) {
    return this.stock.writeOff(dto);
  }

  // GET /api/stock/write-offs?companyId=... — журнал списаний
  @Get('write-offs')
  listWriteOffs(@Query('companyId') companyId: string) {
    return this.stock.listWriteOffs(companyId);
  }

  // POST /api/stock/receive — приём товара (приход)
  @Post('receive')
  receive(@Body() dto: ReceiveStockDto) {
    return this.stock.receive(dto);
  }

  // POST /api/stock/adjust — списание / корректировка
  @Post('adjust')
  adjust(@Body() dto: AdjustStockDto) {
    return this.stock.adjust(dto);
  }

  // POST /api/stock/transfer — перемещение между филиалами
  @Post('transfer')
  transfer(@Body() dto: TransferStockDto) {
    return this.stock.transfer(dto);
  }

  // POST /api/stock/recount — инвентаризация (фактический остаток)
  @Post('recount')
  recount(@Body() dto: RecountStockDto) {
    return this.stock.recount(dto);
  }

  // POST /api/stock/recount-bulk — массовая инвентаризация (лист по филиалу)
  @Post('recount-bulk')
  recountBulk(
    @Body()
    body: {
      companyId: string;
      branchId: string;
      items: Array<{ productId: string; countedQuantity: number }>;
      userId?: string;
    },
  ) {
    return this.stock.recountBulk(
      body.companyId,
      body.branchId,
      body.items ?? [],
      body.userId,
    );
  }

  // GET /api/stock?companyId=... — текущие остатки
  @Get()
  listStock(@Query('companyId') companyId: string) {
    return this.stock.listStock(companyId);
  }

  // GET /api/stock/low?companyId=... — оповещение о нехватке
  @Get('low')
  lowStock(@Query('companyId') companyId: string) {
    return this.stock.lowStock(companyId);
  }

  // GET /api/stock/movements?companyId=... — история движений
  @Get('movements')
  listMovements(@Query('companyId') companyId: string) {
    return this.stock.listMovements(companyId);
  }

  // GET /api/stock/stats?companyId=... — сводка (поставщиков, поступления сегодня)
  @Get('stats')
  stats(@Query('companyId') companyId: string) {
    return this.stock.stats(companyId);
  }
}
