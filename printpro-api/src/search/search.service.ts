import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  // Глобальный поиск по заказам, клиентам, услугам, товарам.
  // companyId и roleId приходят только из JWT (см. SearchController).
  async search(companyId: string, roleId: string, q: string) {
    const query = (q ?? '').trim();
    if (!companyId || query.length < 2) {
      return { orders: [], clients: [], services: [], products: [] };
    }

    // Права роли — чтобы поиск не показывал сущности, недоступные пользователю
    // (например, «Печатник» с orders.view не должен видеть цены услуг/товаров).
    const rolePerms = roleId
      ? await this.prisma.rolePermission.findMany({
          where: { roleId },
          include: { permission: true },
        })
      : [];
    const codes = new Set(rolePerms.map((rp) => rp.permission.code));
    const can = (code: string) => codes.has(code);

    const ci = { contains: query, mode: 'insensitive' as const };

    const [orders, clients, services, products] = await Promise.all([
      can('orders.view')
        ? this.prisma.order.findMany({
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
          })
        : Promise.resolve([]),
      can('clients.view')
        ? this.prisma.client.findMany({
            where: {
              companyId,
              deletedAt: null,
              OR: [{ fullName: ci }, { phone: { contains: query } }],
            },
            select: { id: true, fullName: true, phone: true, type: true },
            take: 6,
          })
        : Promise.resolve([]),
      can('services.view')
        ? this.prisma.service.findMany({
            where: { companyId, deletedAt: null, name: ci },
            select: { id: true, name: true, basePrice: true },
            take: 5,
          })
        : Promise.resolve([]),
      can('products.view')
        ? this.prisma.product.findMany({
            where: { companyId, deletedAt: null, name: ci },
            select: { id: true, name: true, salePrice: true },
            take: 5,
          })
        : Promise.resolve([]),
    ]);

    return { orders, clients, services, products };
  }
}
