import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';

@Module({
  controllers: [ProductsController, StockController],
  providers: [ProductsService, StockService],
})
export class WarehouseModule {}
