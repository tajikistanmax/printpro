import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  // Глобальный поиск по заказам, клиентам, услугам, товарам
  async search(companyId: string, q: string) {
    const query = (q ?? '').trim();
    if (!companyId || query.length < 2) {
      return { orders: [], clients: [], services: [], products: [] };
    }
    const ci = { contains: query, mode: 'insensitive' as const };

    const [orders, clients, services, products] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          companyId,
          deletedAt: null,
          OR: [
            { orderNumber: ci },
            { receiptNumber: ci },
            { client: { fullName: ci } },
            { client: { phone: { contains: query } } },
          ],
        },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          client: { select: { fullName: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.client.findMany({
        where: {
          companyId,
          deletedAt: null,
          OR: [{ fullName: ci }, { phone: { contains: query } }],
        },
        select: { id: true, fullName: true, phone: true, type: true },
        take: 6,
      }),
      this.prisma.service.findMany({
        where: { companyId, name: ci },
        select: { id: true, name: true, basePrice: true },
        take: 5,
      }),
      this.prisma.product.findMany({
        where: { companyId, name: ci },
        select: { id: true, name: true, salePrice: true },
        take: 5,
      }),
    ]);

    return { orders, clients, services, products };
  }
}
