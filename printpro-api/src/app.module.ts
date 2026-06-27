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
import { CashModule } from './cash/cash.module';
import { ProductionModule } from './production/production.module';
import { DesignModule } from './design/design.module';
import { ReportsModule } from './reports/reports.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TelegramModule } from './telegram/telegram.module';
import { SyncModule } from './sync/sync.module';
import { PayrollModule } from './payroll/payroll.module';
import { TasksModule } from './tasks/tasks.module';
import { BranchesModule } from './branches/branches.module';
import { PublicModule } from './public/public.module';
import { EquipmentModule } from './equipment/equipment.module';

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
    OrdersModule, // заказы
    CashModule, // касса: смены, оплаты, движения денег
    ProductionModule, // производство: очередь заданий из заказов
    DesignModule, // дизайн-макеты: версии и согласование
    ReportsModule, // отчёты и финансы
    PurchasingModule, // поставщики, закупки, приёмка
    AuditModule, // журнал действий (глобальный перехватчик)
    SettingsModule, // настройки компании (ключ-значение)
    NotificationsModule, // оповещения (колокольчик)
    TelegramModule, // отправка уведомлений в Telegram
    SyncModule, // синхронизация локальный↔облако
    PayrollModule, // зарплата: ставки, время, авансы, расчёт
    TasksModule, // задачи сотрудникам
    BranchesModule, // филиалы
    PublicModule, // публичный сайт (онлайн-заказы)
    EquipmentModule, // оборудование (принтеры/станки)
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
