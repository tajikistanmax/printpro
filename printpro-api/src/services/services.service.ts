import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  // Создать услугу вместе с тирами цен / размерами / опциями
  create(dto: CreateServiceDto) {
    return this.prisma.service.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        categoryId: dto.categoryId,
        pricingType: dto.pricingType,
        basePrice: dto.basePrice ?? 0,
        designSurcharge: dto.designSurcharge ?? 0,
        minQuantity: dto.minQuantity ?? 1,
        isActive: dto.isActive ?? true,
        priceTiers: dto.priceTiers ? { create: dto.priceTiers } : undefined,
        sizes: dto.sizes ? { create: dto.sizes } : undefined,
        options: dto.options ? { create: dto.options } : undefined,
      },
      include: { priceTiers: true, sizes: true, options: true, category: true },
    });
  }

  // Список услуг компании
  findAll(companyId: string) {
    return this.prisma.service.findMany({
      where: { companyId },
      include: { priceTiers: true, sizes: true, options: true, category: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Одна услуга по id
  async findOne(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: { priceTiers: true, sizes: true, options: true, category: true },
    });
    if (!service) throw new NotFoundException('Услуга не найдена');
    return service;
  }

  // Удалить услугу
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.service.delete({ where: { id } });
  }
}
