import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { PromocodesController } from './promocodes.controller';
import { PromocodesService } from './promocodes.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';

/**
 * HTTP-контракт контроллера промокодов. Поднимаем НАСТОЯЩИЙ контроллер+сервис в
 * тестовом сервере; подменяем только вход (JWT → пользователь компании A) и базу
 * (мок Prisma). Проверяем: companyId берётся из токена (а не из тела), DTO-валидация
 * режет мусорный ввод, а /validate прокидывает код и сумму в сервис.
 */
const COMPANY_A = 'company-A';

describe('PromocodesController (HTTP + DTO, e2e)', () => {
  let app: INestApplication;

  const mockPrisma = {
    promoCode: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new-promo',
        usedCount: 0,
        isActive: true,
        ...data,
      })),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      fields: { maxUses: { _ref: 'PromoCode.maxUses' } },
    },
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PromocodesController],
      providers: [
        PromocodesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = {
            sub: 'cashier-1',
            companyId: COMPANY_A,
            roleId: 'role-1',
          };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app.close();
  });

  describe('POST /promocodes (create)', () => {
    it('валидное тело → 201, companyId из токена, код нормализован', async () => {
      await request(app.getHttpServer())
        .post('/promocodes')
        .send({ code: '  save5 ', value: 5 })
        .expect(201);

      expect(mockPrisma.promoCode.create).toHaveBeenCalledTimes(1);
      const data = mockPrisma.promoCode.create.mock.calls[0][0].data;
      expect(data.companyId).toBe(COMPANY_A); // из токена, не из тела
      expect(data.code).toBe('SAVE5'); // trim + upper
    });

    it('без code → 400 (DTO IsNotEmpty)', async () => {
      await request(app.getHttpServer())
        .post('/promocodes')
        .send({ value: 10 })
        .expect(400);
      expect(mockPrisma.promoCode.create).not.toHaveBeenCalled();
    });

    it('без value → 400 (DTO IsNumber)', async () => {
      await request(app.getHttpServer())
        .post('/promocodes')
        .send({ code: 'X' })
        .expect(400);
      expect(mockPrisma.promoCode.create).not.toHaveBeenCalled();
    });

    it('отрицательный value → 400 (DTO Min 0)', async () => {
      await request(app.getHttpServer())
        .post('/promocodes')
        .send({ code: 'X', value: -5 })
        .expect(400);
      expect(mockPrisma.promoCode.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /promocodes/validate', () => {
    it('прокидывает companyId(токен)+code+subtotal в сервис и возвращает скидку', async () => {
      mockPrisma.promoCode.findFirst.mockResolvedValueOnce({
        id: 'p1',
        companyId: COMPANY_A,
        code: 'SALE10',
        deletedAt: null,
        discountType: 'PERCENT',
        value: 10,
        maxUses: null,
        usedCount: 0,
        validUntil: null,
        isActive: true,
      });

      const res = await request(app.getHttpServer())
        .post('/promocodes/validate')
        .send({ code: 'sale10', subtotal: 200 })
        .expect(201);

      expect(res.body).toEqual({ valid: true, discount: 20, code: 'SALE10' });
      // сервис искал код с company из токена и нормализованным кодом
      const where = mockPrisma.promoCode.findFirst.mock.calls[0][0].where;
      expect(where.companyId).toBe(COMPANY_A);
      expect(where.code).toBe('SALE10');
    });

    it('несуществующий код → valid:false, discount:0', async () => {
      mockPrisma.promoCode.findFirst.mockResolvedValueOnce(null);
      const res = await request(app.getHttpServer())
        .post('/promocodes/validate')
        .send({ code: 'NOPE', subtotal: 100 })
        .expect(201);
      expect(res.body.valid).toBe(false);
      expect(res.body.discount).toBe(0);
    });
  });
});
