import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { QuotesModule } from './quotes/quotes.module';
import { BackupModule } from './backup/backup.module';
import { SearchModule } from './search/search.module';
import { PromocodesModule } from './promocodes/promocodes.module';
import { ComplaintsModule } from './complaints/complaints.module';
import { EmailModule } from './email/email.module';
import { SystemModule } from './system/system.module';
import { UploadsModule } from './uploads/uploads.module';
import { HealthModule } from './health/health.module';
import { DisplayModule } from './display/display.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // загрузка .env
    // Базовый rate-limit (backstop против абуза, 600 запросов/мин на IP —
    // с запасом под занятый офис за одним NAT-IP; строгие лимиты на публичных
    // эндпоинтах навешиваются через @Throttle, P2-5). Применяется глобально
    // через APP_GUARD (см. providers). Health-эндпоинты помечены @SkipThrottle.
    // Хранилище — in-memory (на процесс); для multi-instance нужен shared store (Redis).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
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
    QuotesModule, // коммерческие предложения (КП → заказ)
    BackupModule, // резервная копия данных компании (экспорт)
    SearchModule, // глобальный поиск
    PromocodesModule, // промокоды
    ComplaintsModule, // рекламации (жалобы)
    EmailModule, // email-уведомления (SMTP)
    SystemModule, // информация о системе (версия, СУБД, аптайм)
    UploadsModule, // загрузка изображений (фото товаров/услуг, QR оплаты)
    HealthModule, // health-check для облака (Render) и коробки (Electron)
    DisplayModule, // релей второго экрана покупателя по сети (отдельный ПК)
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Глобальный rate-limit на все эндпоинты (был написан, но не подключён).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
