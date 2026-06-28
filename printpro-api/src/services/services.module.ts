import { Module } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { ServiceCategoriesController } from './service-categories.controller';

@Module({
  controllers: [ServicesController, ServiceCategoriesController],
  providers: [ServicesService],
})
export class ServicesModule {}
