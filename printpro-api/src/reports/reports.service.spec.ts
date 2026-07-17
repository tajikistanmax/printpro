import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const service = new ReportsService({} as PrismaService);

  describe('date range validation', () => {
    it('rejects an invalid date instead of reaching Prisma', async () => {
      await expect(
        service.summary('company-1', 'not-a-date', '2026-07-15'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a range whose start is after its end', async () => {
      await expect(
        service.summary('company-1', '2026-07-20', '2026-07-10'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
