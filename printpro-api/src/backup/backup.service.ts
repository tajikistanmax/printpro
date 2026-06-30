import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Список таблиц для выгрузки + как отфильтровать по компании.
// Для дочерних таблиц фильтруем через связь с родителем.
const TABLES: { model: string; where: (cid: string) => any }[] = [
  { model: 'company', where: (cid) => ({ id: cid }) },
  { model: 'branch', where: (cid) => ({ companyId: cid }) },
  { model: 'role', where: (cid) => ({ companyId: cid }) },
  { model: 'rolePermission', where: (cid) => ({ role: { companyId: cid } }) },
  { model: 'user', where: (cid) => ({ companyId: cid }) },
  { model: 'client', where: (cid) => ({ companyId: cid }) },
  { model: 'clientFile', where: (cid) => ({ client: { companyId: cid } }) },
  { model: 'serviceCategory', where: (cid) => ({ companyId: cid }) },
  { model: 'service', where: (cid) => ({ companyId: cid }) },
  { model: 'servicePriceTier', where: (cid) => ({ service: { companyId: cid } }) },
  { model: 'serviceSize', where: (cid) => ({ service: { companyId: cid } }) },
  { model: 'serviceOption', where: (cid) => ({ service: { companyId: cid } }) },
  { model: 'serviceMaterial', where: (cid) => ({ service: { companyId: cid } }) },
  { model: 'productCategory', where: (cid) => ({ companyId: cid }) },
  { model: 'unit', where: (cid) => ({ companyId: cid }) },
  { model: 'product', where: (cid) => ({ companyId: cid }) },
  { model: 'productBarcodeAlias', where: (cid) => ({ product: { companyId: cid } }) },
  { model: 'supplier', where: (cid) => ({ companyId: cid }) },
  { model: 'stock', where: (cid) => ({ product: { companyId: cid } }) },
  { model: 'stockReceipt', where: (cid) => ({ companyId: cid }) },
  { model: 'stockReceiptItem', where: (cid) => ({ receipt: { companyId: cid } }) },
  { model: 'stockMovement', where: (cid) => ({ companyId: cid }) },
  { model: 'order', where: (cid) => ({ companyId: cid }) },
  { model: 'orderItem', where: (cid) => ({ order: { companyId: cid } }) },
  { model: 'orderRepairDetail', where: (cid) => ({ order: { companyId: cid } }) },
  { model: 'orderRecoveryDetail', where: (cid) => ({ order: { companyId: cid } }) },
  { model: 'orderFile', where: (cid) => ({ order: { companyId: cid } }) },
  { model: 'cashShift', where: (cid) => ({ companyId: cid }) },
  { model: 'payment', where: (cid) => ({ companyId: cid }) },
  { model: 'cashMovement', where: (cid) => ({ companyId: cid }) },
  { model: 'clientDebt', where: (cid) => ({ companyId: cid }) },
  { model: 'task', where: (cid) => ({ companyId: cid }) },
  { model: 'equipment', where: (cid) => ({ companyId: cid }) },
  { model: 'productionJob', where: (cid) => ({ companyId: cid }) },
  { model: 'designProof', where: (cid) => ({ companyId: cid }) },
  { model: 'quote', where: (cid) => ({ companyId: cid }) },
  { model: 'quoteItem', where: (cid) => ({ quote: { companyId: cid } }) },
  { model: 'setting', where: (cid) => ({ companyId: cid }) },
  { model: 'workTimeRecord', where: (cid) => ({ companyId: cid }) },
  { model: 'payrollPeriod', where: (cid) => ({ companyId: cid }) },
  { model: 'salaryAdvance', where: (cid) => ({ companyId: cid }) },
  { model: 'salaryRecord', where: (cid) => ({ companyId: cid }) },
];

@Injectable()
export class BackupService {
  constructor(private readonly prisma: PrismaService) {}

  // Полная выгрузка данных компании в один объект (для скачивания)
  async export(companyId: string) {
    const data: Record<string, unknown[]> = {};
    for (const t of TABLES) {
      const rows = await (this.prisma as any)[t.model].findMany({
        where: t.where(companyId),
      });
      // Не выгружаем хэши паролей
      if (t.model === 'user') {
        for (const u of rows) delete u.passwordHash;
      }
      data[t.model] = rows;
    }
    const counts = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v.length]),
    );
    return {
      app: 'PrintPro',
      version: 1,
      companyId,
      generatedAt: new Date().toISOString(),
      counts,
      data,
    };
  }
}
