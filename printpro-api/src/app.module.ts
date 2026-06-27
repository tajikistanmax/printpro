import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ServicesModule } from './services/services.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { ClientsModule } from './clients/clients.module';
import { OrdersModule } from './orders/orders.module';
import { TasksModule } from './tasks/tasks.module';
import { BranchesModule } from './branches/branches.module';
import { PublicModule } from './public/public.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // загрузка .env
    PrismaModule, // подключение к базе
    AuthModule, // вход и права
    UsersModule, // сотрудники
    RolesModule, // роли и права
    ServicesModule, // модуль «Услуги»
    WarehouseModule, // модуль «Склад + Товары»
    ClientsModule, // клиенты
    OrdersModule, // заказы и касса
    TasksModule, // задачи сотрудникам
    BranchesModule, // филиалы
    PublicModule, // публичный сайт (онлайн-заказы)
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
