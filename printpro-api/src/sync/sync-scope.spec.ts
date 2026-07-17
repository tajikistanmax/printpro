import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SYNC_TABLES, SyncService } from './sync.service';
import { assertSyncRowScope, syncScopeWhere } from './sync-scope';

describe('sync tenant scope', () => {
  it('keeps every updated business model in the sync registry', () => {
    const schema = readFileSync(
      join(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    const syncable = [...schema.matchAll(/^model\s+(\w+)\s+\{[\s\S]*?^\}/gm)]
      .filter((match) => /\bupdatedAt\b/.test(match[0]))
      .map((match) => match[1])
      .filter((name) => name !== 'SyncCursor')
      .sort();
    const registered = SYNC_TABLES.map((table) => table.table).sort();
    expect(registered).toEqual(syncable);

    for (const table of SYNC_TABLES) {
      expect(() => syncScopeWhere(table.model, 'c1')).not.toThrow();
    }
  });

  it('builds direct, relation and global pull scopes', () => {
    expect(syncScopeWhere('order', 'c1')).toEqual({ companyId: 'c1' });
    expect(syncScopeWhere('orderItem', 'c1')).toEqual({
      order: { companyId: 'c1' },
    });
    expect(syncScopeWhere('company', 'c1')).toEqual({ id: 'c1' });
    expect(syncScopeWhere('permission', 'c1')).toEqual({});
    expect(() => syncScopeWhere('unknown', 'c1')).toThrow(BadRequestException);
  });

  it('rejects a direct row from another company', async () => {
    await expect(
      assertSyncRowScope({}, 'order', { companyId: 'c2' }, 'c1'),
    ).rejects.toThrow('another company');
  });

  it('checks the tenant of parent references', async () => {
    const db = {
      order: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    await expect(
      assertSyncRowScope(
        db as never,
        'orderItem',
        { orderId: 'foreign-order' },
        'c1',
      ),
    ).rejects.toThrow('orderItem.orderId belongs to another company');
    expect(db.order.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-order', companyId: 'c1' },
      select: { id: true },
    });
  });

  it('does not let an existing foreign UUID be reassigned to the tenant', async () => {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'same-id',
          companyId: 'foreign-company',
          updatedAt: new Date(0),
        }),
      },
    };
    const service = new SyncService(prisma as never);
    const result = await service.push(
      {
        order: [
          {
            id: 'same-id',
            companyId: 'tenant-company',
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      'K1',
      'tenant-company',
    );
    expect(result).toMatchObject({ applied: 0, failed: 1 });
  });
});
