import { ForbiddenException } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import { SyncController } from './sync.controller';

describe('SyncController tenant identity', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  function signedHeaders(node: string, secret: string, body: unknown) {
    const timestamp = String(Date.now());
    const nonce = 'nonce-1';
    const bodyHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');
    const signature = createHmac('sha256', secret)
      .update(`${node}.${timestamp}.${nonce}.${bodyHash}`)
      .digest('hex');
    return { timestamp, nonce, signature };
  }

  it('binds an HMAC-authenticated node to its configured company', async () => {
    process.env = {
      ...originalEnv,
      SYNC_NODE_SECRETS: 'K1:node-secret',
      SYNC_NODE_COMPANIES: 'K1:company-1',
    };
    const sync = {
      pull: jest.fn().mockResolvedValue({ until: '', changes: {} }),
    };
    const prisma = {
      syncNonce: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const controller = new SyncController(sync as never, prisma as never);
    const body = { since: '2026-01-01T00:00:00.000Z' };
    const auth = signedHeaders('K1', 'node-secret', body);

    await controller.pull(
      'legacy-secret',
      'K1',
      auth.timestamp,
      auth.signature,
      auth.nonce,
      body,
    );

    expect(sync.pull).toHaveBeenCalledWith(body.since, 'K1', 'company-1');
  });

  it('rejects a signed node without a tenant mapping', async () => {
    process.env = {
      ...originalEnv,
      SYNC_NODE_SECRETS: 'K1:node-secret',
      SYNC_NODE_COMPANIES: '',
    };
    const sync = { pull: jest.fn() };
    const prisma = {
      syncNonce: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const controller = new SyncController(sync as never, prisma as never);
    const body = { since: '2026-01-01T00:00:00.000Z' };
    const auth = signedHeaders('K1', 'node-secret', body);

    await expect(
      controller.pull(
        'legacy-secret',
        'K1',
        auth.timestamp,
        auth.signature,
        auth.nonce,
        body,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sync.pull).not.toHaveBeenCalled();
  });
});
