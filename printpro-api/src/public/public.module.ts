import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [ClientsModule], // для поиска/создания клиента
  controllers: [PublicController],
})
export class PublicModule {}
