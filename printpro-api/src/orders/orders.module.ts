import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [ClientsModule], // для поиска/создания клиента
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService], // используется в модуле КП (превращение в заказ)
})
export class OrdersModule {}
