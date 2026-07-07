// Тонкая обёртка для dev/`prisma db seed` (ts-node). Вся логика — в компилируемом
// src/bootstrap/seed.ts, который в проде/коробке запускается как `node dist/bootstrap/seed.js`.
import { PrismaClient } from '@prisma/client';
import { runSeed } from '../src/bootstrap/seed';

const prisma = new PrismaClient();
runSeed(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
