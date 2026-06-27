// Заполнение базы: права, системные роли, администратор.
// Запуск: npx ts-node prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PERMISSIONS, SYSTEM_ROLES } from '../src/auth/permissions';

const prisma = new PrismaClient();

// Фиксированный ID компании — совпадает с DEFAULT_COMPANY_ID на фронтенде,
// чтобы система работала и локально, и в облаке одинаково.
const COMPANY_ID = '7628001a-5f9c-45ec-8f6f-a80280d409c5';

async function main() {
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

  const unit = await prisma.unit.findFirst({ where: { companyId: COMPANY_ID } });
  if (!unit) {
    await prisma.unit.create({
      data: { companyId: COMPANY_ID, name: 'Штука', shortName: 'шт' },
    });
  }
  console.log('Компания/филиал/единица готовы.');

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

      // заменяем набор прав роли
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({
        data: codes
          .filter((c) => codeToId.has(c))
          .map((c) => ({ roleId: role!.id, permissionId: codeToId.get(c)! })),
      });
      console.log(`  Роль «${sysRole.name}»: ${codes.length} прав`);
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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
