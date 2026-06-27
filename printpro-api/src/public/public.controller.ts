import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { OrderStatus, OrderType, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';

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
@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  // Список активных услуг (для выбора на сайте)
  @Get('services')
  services(@Query('companyId') companyId: string) {
    return this.prisma.service.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, pricingType: true, basePrice: true },
      orderBy: { name: 'asc' },
    });
  }

  // Загрузка файла (макета) клиентом
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
          const name = randomUUID() + extname(file.originalname);
          cb(null, name);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // до 50 МБ
    }),
  )
  upload(@UploadedFile() file: any) {
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

    const count = await this.prisma.order.count({
      where: { companyId: dto.companyId },
    });
    const orderNumber = String(count + 1).padStart(5, '0');

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
}
