// Окружение для интеграционных тестов на ЖИВОМ Postgres.
// Направляем PrismaService на ОТДЕЛЬНУЮ тестовую базу (не дев/прод!).
// Базу создаёт/мигрирует scripts (см. package.json test:int:setup или вручную:
//   npx prisma db execute --url .../postgres --stdin  <<<  CREATE DATABASE printpro_test;
//   DATABASE_URL=.../printpro_test npx prisma migrate deploy
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/printpro_test?schema=public';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-integration';
process.env.NODE_ENV = 'test';
