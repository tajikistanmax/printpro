// Аварийный сброс пароля (на случай, если администратор забыл пароль).
// Запускается ТОЛЬКО на компьютере, где работает сервер (доступ к БД) —
// поэтому из интернета это сделать нельзя. Это «аварийный ключ» владельца.
//
// Использование:
//   node scripts/reset-password.mjs <логин> <новый_пароль> [companyId]
// Примеры:
//   node scripts/reset-password.mjs admin НовыйПароль123
//   node scripts/reset-password.mjs admin НовыйПароль123 7628001a-5f9c-45ec-8f6f-a80280d409c5

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const [, , login, newPassword, companyId] = process.argv;

if (!login || !newPassword) {
  console.error(
    'Использование: node scripts/reset-password.mjs <логин> <новый_пароль> [companyId]',
  );
  process.exit(1);
}
if (newPassword.length < 4) {
  console.error('Пароль слишком короткий (минимум 4 символа).');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { login, ...(companyId ? { companyId } : {}) },
    select: { id: true, fullName: true, companyId: true },
  });

  if (users.length === 0) {
    console.error(`Сотрудник с логином «${login}» не найден.`);
    process.exit(1);
  }
  if (users.length > 1) {
    console.error(
      `Найдено несколько сотрудников с логином «${login}» в разных компаниях. Укажите companyId:`,
    );
    users.forEach((u) => console.error(`  - ${u.fullName} · companyId=${u.companyId}`));
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: users[0].id },
    data: { passwordHash },
  });
  console.log(
    `✅ Пароль для «${users[0].fullName}» (логин: ${login}) изменён. Теперь входите с новым паролем.`,
  );
}

main()
  .catch((e) => {
    console.error('Ошибка:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
