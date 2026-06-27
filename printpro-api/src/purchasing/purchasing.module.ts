import { Module } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';

@Module({
  controllers: [PurchasingController],
  providers: [PurchasingService],
})
export class PurchasingModule {}
