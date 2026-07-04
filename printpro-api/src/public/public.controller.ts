import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { PublicRateLimitGuard } from '../auth/rate-limit.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { OrderStatus, OrderType, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nextSeq } from '../common/next-number';
import { ClientsService } from '../clients/clients.service';
import { TelegramService } from '../telegram/telegram.service';
import { LAYOUT_UPLOAD_OPTIONS } from '../uploads/image-upload.options';

class PublicFileDto {
  @IsString() url: string;
  @IsOptional() @IsString() name?: string;
}

class PublicOrderDto {
  @IsString() companyId: string;
  @IsString() clientPhone: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() files?: PublicFileDto[];
}

// Публичные маршруты для сайта клиентов — БЕЗ входа.
// Rate-limit по IP: телефоны/UUID не переберёшь на скорости (С16).
@Controller('public')
@UseGuards(PublicRateLimitGuard)
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly telegram: TelegramService,
  ) {}

  // Запрос на сброс пароля — уведомляет администратора (Telegram).
  // Не раскрываем, существует ли логин.
  @Post('password-reset-request')
  async passwordResetRequest(
    @Body() body: { companyId: string; login: string },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { companyId: body.companyId, login: body.login },
      select: { fullName: true, login: true },
    });
    if (user) {
      void this.telegram.send(
        body.companyId,
        `🔑 Запрос на сброс пароля: ${user.fullName} (логин: <b>${user.login}</b>). Сбросьте пароль в разделе «Сотрудники».`,
      );
    }
    return { ok: true };
  }

  // Список активных услуг (для выбора на сайте)
  @Get('services')
  services(@Query('companyId') companyId: string) {
    return this.prisma.service.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, pricingType: true, basePrice: true },
      orderBy: { name: 'asc' },
    });
  }

  // Загрузка файла (макета) клиентом. Только изображения/PDF (без SVG/HTML/JS).
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', LAYOUT_UPLOAD_OPTIONS))
  upload(@UploadedFile() file: any) {
    if (!file) return { url: null };
    return {
      url: `/uploads/${file.filename}`,
      name: file.originalname,
      size: file.size,
    };
  }

  // Создание онлайн-заказа с сайта
  async createOrderHandler(dto: PublicOrderDto) {
    const client = await this.clients.findOrCreate(
      dto.companyId,
      dto.clientPhone,
      dto.clientName,
    );

    const orderNumber = String(
      await nextSeq(this.prisma, dto.companyId, 'ORDER'),
    ).padStart(5, '0');

    const order = await this.prisma.order.create({
      data: {
        companyId: dto.companyId,
        orderNumber,
        clientId: client.id,
        orderType: OrderType.PRINT,
        status: OrderStatus.ACCEPTED,
        paymentStatus: PaymentStatus.UNPAID,
        note: 'Онлайн-заказ с сайта',
        total: 0,
        paid: 0,
        balanceDue: 0,
        items: {
          create: [
            {
              itemType: 'SERVICE',
              serviceId: dto.serviceId,
              description: dto.description ?? 'Заказ с сайта',
              quantity: 1,
              unitPrice: 0,
              lineTotal: 0,
            },
          ],
        },
        files: dto.files?.length
          ? {
              create: dto.files.map((f) => ({
                fileUrl: f.url,
                fileName: f.name,
                type: 'upload',
              })),
            }
          : undefined,
      },
      include: { files: true },
    });

    return { orderNumber: order.orderNumber, id: order.id };
  }

  @Post('orders')
  createOrder(@Body() dto: PublicOrderDto) {
    return this.createOrderHandler(dto);
  }

  // Публичный просмотр чека по QR (без входа). Ссылка вида /r/:id на сайте.
  @Get('receipt/:id')
  async receipt(@Param('id') id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        company: { select: { name: true } },
        items: {
          include: {
            service: { select: { name: true } },
            product: { select: { name: true } },
          },
        },
      },
    });
    if (!order) return { found: false };

    const rows = await this.prisma.setting.findMany({
      where: {
        companyId: order.companyId,
        key: { in: ['companyName', 'companyAddress', 'phone', 'companyInn'] },
      },
    });
    const s: Record<string, string> = {};
    for (const r of rows) s[r.key] = r.value ?? '';

    return {
      found: true,
      company: {
        name: s.companyName || order.company?.name || 'PrintPro',
        address: s.companyAddress || null,
        phone: s.phone || null,
        inn: s.companyInn || null,
      },
      orderNumber: order.orderNumber,
      date: order.createdAt,
      paymentStatus: order.paymentStatus,
      total: Number(order.total),
      paid: Number(order.paid),
      // balanceDue намеренно не отдаём: чек по QR может открыть кто угодно,
      // долг клиента — не публичная информация (аудит 06, P1-9)
      items: order.items.map((it) => ({
        name:
          it.description || it.service?.name || it.product?.name || 'Позиция',
        quantity: Number(it.quantity),
        lineTotal: Number(it.lineTotal),
      })),
    };
  }

  // ---------- Личный кабинет клиента (по телефону, без пароля) ----------

  // Заказы клиента по номеру телефона
  @Get('my-orders')
  async myOrders(
    @Query('companyId') companyId: string,
    @Query('phone') phone: string,
  ) {
    if (!companyId || !phone) return { client: null, orders: [] };
    const client = await this.prisma.client.findFirst({
      where: { companyId, phone, deletedAt: null },
      select: { id: true, fullName: true, phone: true },
    });
    if (!client) return { client: null, orders: [] };

    const orders = await this.prisma.order.findMany({
      where: { companyId, clientId: client.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        total: true,
        balanceDue: true,
        createdAt: true,
        items: { select: { description: true, quantity: true } },
      },
    });
    return { client, orders };
  }

  // Повторить заказ из кабинета (создаёт копию по позициям; проверяем телефон)
  @Post('reorder')
  async publicReorder(
    @Body() body: { companyId: string; phone: string; orderId: string },
  ) {
    const src = await this.prisma.order.findUnique({
      where: { id: body.orderId },
      include: { items: true, client: true },
    });
    if (
      !src ||
      src.companyId !== body.companyId ||
      src.client?.phone !== body.phone
    ) {
      return { ok: false, message: 'Заказ не найден' };
    }

    const items = src.items.map((it) => ({
      itemType: it.itemType,
      serviceId: it.serviceId ?? undefined,
      productId: it.productId ?? undefined,
      description: it.description,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: Number((Number(it.quantity) * Number(it.unitPrice)).toFixed(2)),
    }));
    const total = Number(items.reduce((s, it) => s + it.lineTotal, 0).toFixed(2));

    const node = (process.env.NODE_ID ?? 'C').toUpperCase();
    const year = new Date().getFullYear();
    const orderSeq = await nextSeq(this.prisma, body.companyId, 'ORDER');
    const orderNumber = `ORD-${node}-${year}-${String(orderSeq).padStart(6, '0')}`;

    const order = await this.prisma.order.create({
      data: {
        companyId: src.companyId,
        clientId: src.clientId,
        orderNumber,
        orderType: src.orderType,
        status: OrderStatus.ACCEPTED,
        paymentStatus: PaymentStatus.UNPAID,
        note: `Повтор онлайн-заказа №${src.orderNumber}`,
        total,
        paid: 0,
        balanceDue: total,
        items: { create: items },
      },
      select: { id: true, orderNumber: true },
    });
    return { ok: true, orderNumber: order.orderNumber, id: order.id };
  }
}
