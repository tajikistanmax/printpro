// Заполнение базы: справочники, права, системные роли, администратор.
// Компилируемый (не требует ts-node в проде/коробке): `node dist/bootstrap/seed.js`.
// Идемпотентен: повторный запуск не теряет и не затирает данные/кастомизацию ролей.
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PERMISSIONS, SYSTEM_ROLES } from '../auth/permissions';

// Фиксированный ID компании (облако/дефолт) — совпадает с fallback на фронтенде,
// чтобы система работала и локально, и в облаке одинаково.
const DEFAULT_COMPANY_ID = '7628001a-5f9c-45ec-8f6f-a80280d409c5';

// В коробке (BOX_MODE=1) у каждого клиента — СВОЙ companyId: на первом запуске
// генерируем случайный, на последующих переиспользуем уже созданный (иначе seed
// плодил бы новые компании). Фронт коробки узнаёт его через /api/system/company-id.
// Без BOX_MODE (облако) — фиксированный DEFAULT_COMPANY_ID (поведение как было).
async function resolveCompanyId(prisma: PrismaClient): Promise<string> {
  if (process.env.BOX_MODE === '1') {
    const existing = await prisma.company.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return existing?.id ?? randomUUID();
  }
  return DEFAULT_COMPANY_ID;
}

export async function runSeed(prisma: PrismaClient): Promise<void> {
  const COMPANY_ID = await resolveCompanyId(prisma);
  // 0. Гарантируем компанию, филиал и единицу измерения
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    create: {
      id: COMPANY_ID,
      name: 'DushanbePrint',
      currency: 'TJS',
      language: 'ru',
    },
    update: {},
  });

  const branch = await prisma.branch.findFirst({
    where: { companyId: COMPANY_ID },
  });
  if (!branch) {
    await prisma.branch.create({
      data: { companyId: COMPANY_ID, name: 'Главный офис', isActive: true },
    });
  }

  // Единицы измерения по умолчанию (шт — основная). Идемпотентно по shortName.
  const UNITS = [
    { name: 'Штука', shortName: 'шт' },
    { name: 'Килограмм', shortName: 'кг' },
    { name: 'Грамм', shortName: 'г' },
    { name: 'Метр', shortName: 'м' },
    { name: 'Сантиметр', shortName: 'см' },
    { name: 'Литр', shortName: 'л' },
    { name: 'Упаковка', shortName: 'упак' },
    { name: 'Рулон', shortName: 'рул' },
    { name: 'Лист', shortName: 'лист' },
  ];
  for (const u of UNITS) {
    const ex = await prisma.unit.findFirst({
      where: { companyId: COMPANY_ID, shortName: u.shortName },
    });
    if (!ex)
      await prisma.unit.create({
        data: { companyId: COMPANY_ID, ...u, isDefault: u.shortName === 'шт' },
      });
  }
  // «шт» — единица по умолчанию, если ни одна ещё не назначена
  const hasDefaultUnit = await prisma.unit.findFirst({
    where: { companyId: COMPANY_ID, isDefault: true },
  });
  if (!hasDefaultUnit) {
    const sht = await prisma.unit.findFirst({
      where: { companyId: COMPANY_ID, shortName: 'шт' },
    });
    if (sht)
      await prisma.unit.update({ where: { id: sht.id }, data: { isDefault: true } });
  }

  // Категории товаров по умолчанию (пару штук — остальное добавят в Настройках)
  const PRODUCT_CATEGORIES = ['Сувениры', 'Рамки', 'Бумага', 'Канцтовары'];
  for (const name of PRODUCT_CATEGORIES) {
    const ex = await prisma.productCategory.findFirst({
      where: { companyId: COMPANY_ID, name },
    });
    if (!ex)
      await prisma.productCategory.create({
        data: { companyId: COMPANY_ID, name },
      });
  }

  // Категории услуг по умолчанию (профиль типографии)
  const SERVICE_CATEGORIES = [
    'Печать документов', 'Фото на документы', 'Визитки', 'Буклеты', 'Листовки',
    'Баннеры', 'Наклейки', 'Плакаты', 'Сувенирная продукция', 'Ксерокопия',
    'Гравировка', 'Дизайнерские услуги', 'Реставрация', 'Полиграфия', 'Фотоуслуги',
    'Сувенирная печать', 'Оформление в рамки', 'Дизайн', 'Ремонт принтеров',
    'Восстановление данных',
  ];
  for (const name of SERVICE_CATEGORIES) {
    const ex = await prisma.serviceCategory.findFirst({
      where: { companyId: COMPANY_ID, name },
    });
    if (!ex)
      await prisma.serviceCategory.create({
        data: { companyId: COMPANY_ID, name },
      });
  }
  console.log('Справочники (единицы/категории) готовы.');

  // 1. Справочник прав (глобальный) — добавляем недостающие
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: { code: p.code, label: p.label, group: p.group },
      update: { label: p.label, group: p.group },
    });
  }
  console.log(`Прав в справочнике: ${PERMISSIONS.length}`);

  const allPerms = await prisma.permission.findMany();
  const codeToId = new Map(allPerms.map((p) => [p.code, p.id]));

  // 2. Для каждой компании создаём системные роли и админа
  const companies = await prisma.company.findMany();
  for (const company of companies) {
    console.log(`\nКомпания: ${company.name}`);

    let adminRoleId: string | null = null;

    for (const sysRole of SYSTEM_ROLES) {
      // роль (по имени внутри компании)
      let role = await prisma.role.findFirst({
        where: { companyId: company.id, name: sysRole.name },
      });
      if (!role) {
        role = await prisma.role.create({
          data: { companyId: company.id, name: sysRole.name, isSystem: true },
        });
      }
      if (sysRole.name === 'Администратор') adminRoleId = role.id;

      // какие коды прав назначить
      const codes =
        sysRole.permissions === '*'
          ? PERMISSIONS.map((p) => p.code)
          : sysRole.permissions;
      const wantIds = codes
        .filter((c) => codeToId.has(c))
        .map((c) => codeToId.get(c)!);

      const existing = await prisma.rolePermission.findMany({
        where: { roleId: role.id },
        select: { permissionId: true },
      });
      const haveIds = new Set(existing.map((e) => e.permissionId));
      const isSuperuser = sysRole.permissions === '*';

      if (existing.length === 0) {
        // Первичная настройка роли — назначаем полный дефолтный набор.
        await prisma.rolePermission.createMany({
          data: wantIds.map((permissionId) => ({ roleId: role!.id, permissionId })),
        });
        console.log(`  Роль «${sysRole.name}»: ${wantIds.length} прав (первичная настройка)`);
      } else if (isSuperuser) {
        // Администратор (суперюзер) — ВСЕГДА должен иметь все права: до-назначаем
        // недостающие (например, добавленные новой версией), но НЕ удаляем.
        const toAdd = wantIds.filter((id) => !haveIds.has(id));
        if (toAdd.length) {
          await prisma.rolePermission.createMany({
            data: toAdd.map((permissionId) => ({ roleId: role!.id, permissionId })),
          });
        }
        console.log(`  Роль «${sysRole.name}»: суперюзер, +${toAdd.length} новых прав`);
      } else {
        // Роль уже настроена — НЕ трогаем (сохраняем ручную кастомизацию прав,
        // раньше seed её затирал на каждом деплое).
        console.log(`  Роль «${sysRole.name}»: уже настроена (${existing.length} прав) — не трогаю`);
      }
    }

    // 3. Администратор (логин admin / пароль admin123)
    const existingAdmin = await prisma.user.findFirst({
      where: { companyId: company.id, login: 'admin' },
    });
    if (!existingAdmin && adminRoleId) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      await prisma.user.create({
        data: {
          companyId: company.id,
          fullName: 'Администратор',
          login: 'admin',
          passwordHash,
          roleId: adminRoleId,
        },
      });
      console.log('  Создан администратор: login=admin / password=admin123');
    } else {
      console.log('  Администратор уже существует — пропускаю');
    }
  }

  console.log('\nГотово.');
}

// Прямой запуск: `node dist/bootstrap/seed.js` (прод/коробка) или ts-node (dev).
if (require.main === module) {
  const prisma = new PrismaClient();
  runSeed(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => void prisma.$disconnect());
}
