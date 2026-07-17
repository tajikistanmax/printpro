import { BadRequestException } from '@nestjs/common';

type DynamicDb = Record<
  string,
  {
    findFirst(args: unknown): Promise<unknown>;
  }
>;

type ScopedReference = {
  field: string;
  model: string;
  required?: boolean;
};

// Модели, у которых companyId хранится прямо в строке.
const DIRECT_COMPANY_MODELS = new Set([
  'branch',
  'role',
  'user',
  'client',
  'serviceCategory',
  'service',
  'productCategory',
  'unit',
  'product',
  'productBarcodeAlias',
  'supplier',
  'supplierPayment',
  'purchaseRequest',
  'stockReceipt',
  'order',
  'heldSale',
  'quote',
  'promoCode',
  'complaint',
  'cashShift',
  'payment',
  'cashMovement',
  'clientDebt',
  'return',
  'stockMovement',
  'writeOff',
  'task',
  'equipment',
  'productionJob',
  'designProof',
  'setting',
  'workTimeRecord',
  'payrollPeriod',
  'salaryAdvance',
  'salaryRecord',
]);

// Permission — общий справочник кодов, одинаковый для всех компаний. Узлы могут
// получать его из облака, но не должны менять глобальные строки в облачной БД.
const GLOBAL_SYNC_MODELS = new Set(['permission']);

const RELATION_SCOPES: Record<string, (companyId: string) => object> = {
  rolePermission: (companyId) => ({ role: { companyId } }),
  clientFile: (companyId) => ({ client: { companyId } }),
  servicePriceTier: (companyId) => ({ service: { companyId } }),
  serviceSize: (companyId) => ({ service: { companyId } }),
  serviceOption: (companyId) => ({ service: { companyId } }),
  serviceMaterial: (companyId) => ({ service: { companyId } }),
  stock: (companyId) => ({ product: { companyId } }),
  stockReceiptItem: (companyId) => ({ receipt: { companyId } }),
  orderItem: (companyId) => ({ order: { companyId } }),
  orderStatusHistory: (companyId) => ({ order: { companyId } }),
  orderRepairDetail: (companyId) => ({ order: { companyId } }),
  orderRecoveryDetail: (companyId) => ({ order: { companyId } }),
  orderFile: (companyId) => ({ order: { companyId } }),
  quoteItem: (companyId) => ({ quote: { companyId } }),
};

// Все tenant-зависимые FK проверяются до upsert. Одной проверки companyId в
// дочерней строке недостаточно: скомпрометированный узел мог бы привязать свою
// строку к заказу/клиенту/пользователю другой компании и затем прочитать данные
// через include. Обязательные ссылки также не разрешаем опускать.
const SCOPED_REFERENCES: Record<string, ScopedReference[]> = {
  rolePermission: [
    { field: 'roleId', model: 'role', required: true },
    { field: 'permissionId', model: 'permission', required: true },
  ],
  user: [
    { field: 'branchId', model: 'branch' },
    { field: 'roleId', model: 'role' },
  ],
  clientFile: [{ field: 'clientId', model: 'client', required: true }],
  serviceCategory: [{ field: 'parentId', model: 'serviceCategory' }],
  service: [{ field: 'categoryId', model: 'serviceCategory' }],
  servicePriceTier: [{ field: 'serviceId', model: 'service', required: true }],
  serviceSize: [{ field: 'serviceId', model: 'service', required: true }],
  serviceOption: [{ field: 'serviceId', model: 'service', required: true }],
  productCategory: [{ field: 'parentId', model: 'productCategory' }],
  product: [
    { field: 'categoryId', model: 'productCategory' },
    { field: 'unitId', model: 'unit' },
  ],
  productBarcodeAlias: [
    { field: 'productId', model: 'product', required: true },
  ],
  serviceMaterial: [
    { field: 'serviceId', model: 'service', required: true },
    { field: 'productId', model: 'product', required: true },
  ],
  stock: [
    { field: 'productId', model: 'product', required: true },
    { field: 'branchId', model: 'branch', required: true },
  ],
  stockReceipt: [
    { field: 'supplierId', model: 'supplier' },
    { field: 'branchId', model: 'branch' },
  ],
  supplierPayment: [
    { field: 'supplierId', model: 'supplier', required: true },
    { field: 'userId', model: 'user' },
  ],
  purchaseRequest: [{ field: 'createdById', model: 'user' }],
  stockReceiptItem: [
    { field: 'receiptId', model: 'stockReceipt', required: true },
    { field: 'productId', model: 'product', required: true },
  ],
  order: [
    { field: 'branchId', model: 'branch' },
    { field: 'clientId', model: 'client' },
    { field: 'assignedUserId', model: 'user' },
    { field: 'createdById', model: 'user' },
    { field: 'designerId', model: 'user' },
    { field: 'operatorId', model: 'user' },
  ],
  orderItem: [
    { field: 'orderId', model: 'order', required: true },
    { field: 'serviceId', model: 'service' },
    { field: 'productId', model: 'product' },
  ],
  heldSale: [
    { field: 'branchId', model: 'branch' },
    { field: 'userId', model: 'user' },
  ],
  orderStatusHistory: [
    { field: 'orderId', model: 'order', required: true },
    { field: 'userId', model: 'user' },
  ],
  orderRepairDetail: [{ field: 'orderId', model: 'order', required: true }],
  orderRecoveryDetail: [{ field: 'orderId', model: 'order', required: true }],
  orderFile: [{ field: 'orderId', model: 'order', required: true }],
  quote: [
    { field: 'clientId', model: 'client' },
    { field: 'convertedOrderId', model: 'order' },
  ],
  quoteItem: [
    { field: 'quoteId', model: 'quote', required: true },
    { field: 'serviceId', model: 'service' },
    { field: 'productId', model: 'product' },
  ],
  complaint: [
    { field: 'orderId', model: 'order' },
    { field: 'clientId', model: 'client' },
    { field: 'createdById', model: 'user' },
  ],
  cashShift: [
    { field: 'branchId', model: 'branch' },
    { field: 'userId', model: 'user', required: true },
  ],
  payment: [
    { field: 'orderId', model: 'order' },
    { field: 'shiftId', model: 'cashShift' },
    { field: 'userId', model: 'user' },
  ],
  cashMovement: [{ field: 'shiftId', model: 'cashShift' }],
  clientDebt: [
    { field: 'clientId', model: 'client', required: true },
    { field: 'orderId', model: 'order' },
  ],
  return: [
    { field: 'orderId', model: 'order' },
    { field: 'branchId', model: 'branch' },
    { field: 'clientId', model: 'client' },
    { field: 'userId', model: 'user' },
  ],
  stockMovement: [
    { field: 'productId', model: 'product', required: true },
    { field: 'branchId', model: 'branch' },
    { field: 'orderId', model: 'order' },
    { field: 'userId', model: 'user' },
    { field: 'productionJobId', model: 'productionJob' },
  ],
  writeOff: [
    { field: 'branchId', model: 'branch' },
    { field: 'productId', model: 'product', required: true },
    { field: 'userId', model: 'user' },
  ],
  task: [
    { field: 'orderId', model: 'order' },
    { field: 'assignedUserId', model: 'user' },
    { field: 'createdById', model: 'user' },
  ],
  equipment: [{ field: 'branchId', model: 'branch' }],
  productionJob: [
    { field: 'orderId', model: 'order', required: true },
    { field: 'assignedUserId', model: 'user' },
    { field: 'equipmentId', model: 'equipment' },
  ],
  designProof: [
    { field: 'orderId', model: 'order', required: true },
    { field: 'assignedUserId', model: 'user' },
  ],
  workTimeRecord: [{ field: 'userId', model: 'user', required: true }],
  salaryAdvance: [{ field: 'userId', model: 'user', required: true }],
  salaryRecord: [
    { field: 'periodId', model: 'payrollPeriod', required: true },
    { field: 'userId', model: 'user', required: true },
  ],
};

export function isGlobalSyncModel(model: string): boolean {
  return GLOBAL_SYNC_MODELS.has(model);
}

export function syncScopeWhere(model: string, companyId: string): object {
  if (model === 'company') return { id: companyId };
  if (GLOBAL_SYNC_MODELS.has(model)) return {};
  if (DIRECT_COMPANY_MODELS.has(model)) return { companyId };
  const relationScope = RELATION_SCOPES[model];
  if (!relationScope) {
    throw new BadRequestException(`Sync model has no tenant scope: ${model}`);
  }
  return relationScope(companyId);
}

export async function assertSyncRowScope(
  db: DynamicDb,
  model: string,
  row: Record<string, unknown>,
  companyId: string,
): Promise<void> {
  if (model === 'company') {
    if (row.id !== companyId) {
      throw new BadRequestException('Sync row belongs to another company');
    }
  } else if (DIRECT_COMPANY_MODELS.has(model)) {
    if (row.companyId !== companyId) {
      throw new BadRequestException('Sync row belongs to another company');
    }
  } else if (!GLOBAL_SYNC_MODELS.has(model) && !RELATION_SCOPES[model]) {
    throw new BadRequestException(`Sync model has no tenant scope: ${model}`);
  }

  for (const ref of SCOPED_REFERENCES[model] ?? []) {
    const id = row[ref.field];
    if (id === null || id === undefined || id === '') {
      if (ref.required) {
        throw new BadRequestException(`Sync row is missing ${ref.field}`);
      }
      continue;
    }
    if (typeof id !== 'string') {
      throw new BadRequestException(`Invalid sync reference ${ref.field}`);
    }
    const parent = await db[ref.model].findFirst({
      where: { id, ...syncScopeWhere(ref.model, companyId) },
      select: { id: true },
    });
    if (!parent) {
      throw new BadRequestException(
        `Sync reference ${model}.${ref.field} belongs to another company`,
      );
    }
  }
}
