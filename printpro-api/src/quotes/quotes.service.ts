import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderType, QuoteStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { OrdersService } from '../orders/orders.service';
import { CreateQuoteDto } from './dto/quote.dto';

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly orders: OrdersService,
  ) {}

  async create(dto: CreateQuoteDto) {
    // Клиент: по id или телефону (найдём/создадим)
    let clientId = dto.clientId;
    if (!clientId && dto.clientPhone) {
      const c = await this.clients.findOrCreate(
        dto.companyId,
        dto.clientPhone,
        dto.clientName,
      );
      clientId = c.id;
    }

    const items = dto.items.map((it) => ({
      ...it,
      lineTotal: Number((it.quantity * it.unitPrice).toFixed(2)),
    }));
    const total = Number(
      items.reduce((s, it) => s + it.lineTotal, 0).toFixed(2),
    );

    const node = (process.env.NODE_ID ?? 'C').toUpperCase();
    const count = await this.prisma.quote.count({
      where: { companyId: dto.companyId },
    });
    const year = new Date().getFullYear();
    const number = `КП-${node}-${year}-${String(count + 1).padStart(5, '0')}`;

    return this.prisma.quote.create({
      data: {
        companyId: dto.companyId,
        clientId,
        number,
        title: dto.title,
        note: dto.note,
        total,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        items: {
          create: items.map((it) => ({
            itemType: it.itemType,
            serviceId: it.serviceId,
            productId: it.productId,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            lineTotal: it.lineTotal,
          })),
        },
      },
      include: this.includes(),
    });
  }

  findAll(companyId: string, status?: QuoteStatus) {
    return this.prisma.quote.findMany({
      where: { companyId, deletedAt: null, ...(status ? { status } : {}) },
      include: this.includes(),
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async findOne(id: string) {
    const q = await this.prisma.quote.findUnique({
      where: { id },
      include: this.includes(),
    });
    if (!q) throw new NotFoundException('КП не найдено');
    return q;
  }

  async updateStatus(id: string, status: QuoteStatus) {
    await this.findOne(id);
    return this.prisma.quote.update({
      where: { id },
      data: { status },
      include: this.includes(),
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.quote.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  // Превратить КП в заказ
  async convert(id: string) {
    const q = await this.findOne(id);
    if (q.convertedOrderId) {
      throw new BadRequestException('КП уже превращено в заказ');
    }
    const order = await this.orders.create({
      companyId: q.companyId,
      clientId: q.clientId ?? undefined,
      orderType: OrderType.PRINT,
      note: q.title ?? q.note ?? undefined,
      items: q.items.map((it) => ({
        itemType: it.itemType,
        serviceId: it.serviceId ?? undefined,
        productId: it.productId ?? undefined,
        description: it.description ?? undefined,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
      })),
    });

    await this.prisma.quote.update({
      where: { id },
      data: { status: QuoteStatus.ACCEPTED, convertedOrderId: order.id },
    });

    return order;
  }

  private includes() {
    return {
      client: { select: { id: true, fullName: true, phone: true } },
      items: true,
    };
  }
}
