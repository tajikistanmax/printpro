import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DisplayController } from './display.controller';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';

/**
 * Смоук-тест сетевого «второго экрана»: касса (авторизованная) публикует
 * состояние корзины в релей, а второй экран НА ДРУГОМ КОМПЬЮТЕРЕ забирает его по
 * сети, предъявляя companyId + секретный токен. Поднимаем НАСТОЯЩИЙ контроллер в
 * тестовом HTTP-сервере; подменяем только вход (JWT) и базу (таблицу токенов).
 */
const COMPANY_A = 'company-A';
const COMPANY_B = 'company-B';
const GOOD_TOKEN = 'good-secret-token';

// Пример корзины, как её шлёт касса (важно: с названиями и ценами товаров).
const CART_STATE = {
  type: 'cart',
  shopName: 'PrintPro',
  lines: [
    { name: 'Визитки', qty: 100, price: 0.5, total: 50 },
    { name: 'Баннер 2×1', qty: 1, price: 120, total: 120 },
  ],
  subtotal: 170,
  discount: 20,
  total: 150,
};

describe('DisplayController (сетевой второй экран, e2e)', () => {
  let app: INestApplication;

  // Мок базы: токен привязки хранится в Setting. Есть только у компании A.
  const mockPrisma = {
    setting: {
      findFirst: jest.fn(
        async ({ where }: { where: { companyId: string; key: string } }) =>
          where.companyId === COMPANY_A && where.key === 'displayToken'
            ? { value: GOOD_TOKEN }
            : null,
      ),
      upsert: jest.fn(async ({ create }: { create: { value: string } }) => ({
        value: create.value,
      })),
    },
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DisplayController],
      providers: [{ provide: PrismaService, useValue: mockPrisma }],
    })
      // Вход: вместо реального JWT кладём в запрос пользователя компании A.
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
    // Как в проде: whitelist срезает лишние верхнеуровневые поля, но не трогает
    // внутренние ключи `state`.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('касса публикует корзину → второй экран по сети получает ТЕ ЖЕ товары', async () => {
    // 1) Касса (авторизована) шлёт корзину. Добавляем лишнее поле — whitelist его срежет.
    await request(app.getHttpServer())
      .post('/display/state')
      .send({ state: CART_STATE, мусор: 'срезать' })
      .expect(201)
      .expect({ ok: true });

    // 2) Второй экран на другом ПК забирает состояние по companyId + токену.
    const res = await request(app.getHttpServer())
      .get('/display/state')
      .query({ companyId: COMPANY_A, token: GOOD_TOKEN })
      .expect(200);

    // Пришла именно та корзина — с названиями и ценами товаров.
    expect(res.body.state).toEqual(CART_STATE);
    expect(res.body.state.lines[0].name).toBe('Визитки');
  });

  it('неверный токен → ничего не отдаём (чужой не подсмотрит)', async () => {
    const res = await request(app.getHttpServer())
      .get('/display/state')
      .query({ companyId: COMPANY_A, token: 'wrong-token' })
      .expect(200);
    expect(res.body.state).toBeNull();
  });

  it('без токена → ничего не отдаём', async () => {
    const res = await request(app.getHttpServer())
      .get('/display/state')
      .query({ companyId: COMPANY_A })
      .expect(200);
    expect(res.body.state).toBeNull();
  });

  it('другая компания с тем же токеном → ничего (изоляция арендаторов)', async () => {
    const res = await request(app.getHttpServer())
      .get('/display/state')
      .query({ companyId: COMPANY_B, token: GOOD_TOKEN })
      .expect(200);
    expect(res.body.state).toBeNull();
  });

  it('/display/pairing генерирует криптослучайный токен привязки (16 байт hex)', async () => {
    // Для этого теста у компании токена ещё нет → контроллер сгенерирует новый.
    mockPrisma.setting.findFirst.mockResolvedValueOnce(null);
    const res = await request(app.getHttpServer())
      .get('/display/pairing')
      .expect(200);
    expect(res.body.token).toMatch(/^[a-f0-9]{32}$/);
  });
});
