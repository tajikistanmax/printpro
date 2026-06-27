import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { QuotesController } from './quotes.controller';
import { ClientsModule } from '../clients/clients.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [ClientsModule, OrdersModule],
  controllers: [QuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
