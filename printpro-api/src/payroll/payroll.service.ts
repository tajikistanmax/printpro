import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SalaryType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddAdvanceDto,
  AddWorkTimeDto,
  CreatePeriodDto,
  SetSalaryDto,
  UpdateRecordDto,
} from './dto/payroll.dto';

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Ставки сотрудников ----------
  async setSalary(userId: string, dto: SetSalaryDto, companyId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        position: dto.position,
        salaryType: dto.salaryType,
        rate: dto.rate,
      },
      select: {
        id: true,
        fullName: true,
        position: true,
        salaryType: true,
        rate: true,
      },
    });
  }

  async staff(companyId: string) {
    const users = await this.prisma.user.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true,
        fullName: true,
        position: true,
        salaryType: true,
        rate: true,
        role: { select: { name: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    return users.map((u) => ({ ...u, rate: Number(u.rate) }));
  }

  // ---------- Рабочее время ----------
  addWorkTime(dto: AddWorkTimeDto) {
    return this.prisma.workTimeRecord.create({
      data: {
        companyId: dto.companyId,
        userId: dto.userId,
        hours: dto.hours,
        note: dto.note,
        date: dto.date ? new Date(dto.date) : undefined,
      },
    });
  }

  // ---------- Авансы ----------
  addAdvance(dto: AddAdvanceDto) {
    return this.prisma.salaryAdvance.create({
      data: {
        companyId: dto.companyId,
        userId: dto.userId,
        amount: dto.amount,
        note: dto.note,
      },
    });
  }

  // ---------- Периоды ----------
  createPeriod(dto: CreatePeriodDto) {
    // Конец периода — включительно до конца дня, иначе записи за последний
    // день (со временем > 00:00) не попадут в расчёт.
    const endDate = new Date(dto.endDate);
    endDate.setHours(23, 59, 59, 999);
    return this.prisma.payrollPeriod.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate,
      },
    });
  }

  listPeriods(companyId: string) {
    return this.prisma.payrollPeriod.findMany({
      where: { companyId },
      orderBy: { startDate: 'desc' },
    });
  }

  async closePeriod(id: string, companyId: string) {
    await this.ensurePeriod(id, companyId);
    return this.prisma.payrollPeriod.update({
      where: { id },
      data: { isClosed: true },
    });
  }

  // ---------- Расчёт зарплаты за период ----------
  async calculate(periodId: string, companyId: string) {
    const period = await this.ensurePeriod(periodId, companyId);
    if (period.isClosed) {
      throw new BadRequestException('Период закрыт');
    }

    const users = await this.prisma.user.findMany({
      where: { companyId: period.companyId, isActive: true },
    });

    for (const u of users) {
      // Уже выплаченные записи не пересчитываем — иначе исказим факт выплаты.
      const existing = await this.prisma.salaryRecord.findUnique({
        where: { periodId_userId: { periodId, userId: u.id } },
      });
      if (existing?.isPaid) continue;

      // База: оклад или часы * ставка
      let base = Number(u.rate);
      if (u.salaryType === SalaryType.HOURLY) {
        const wt = await this.prisma.workTimeRecord.aggregate({
          where: {
            userId: u.id,
            date: { gte: period.startDate, lte: period.endDate },
          },
          _sum: { hours: true },
        });
        base = Number(u.rate) * Number(wt._sum.hours ?? 0);
      }

      // Авансы за период
      const adv = await this.prisma.salaryAdvance.aggregate({
        where: {
          userId: u.id,
          date: { gte: period.startDate, lte: period.endDate },
        },
        _sum: { amount: true },
      });
      const advance = Number(adv._sum.amount ?? 0);

      // Сохраняем бонус/удержание из существующей записи
      const bonus = existing ? Number(existing.bonus) : 0;
      const deduction = existing ? Number(existing.deduction) : 0;
      // Итог не может быть отрицательным (авансы/удержания больше базы).
      const total = Math.max(
        0,
        Number((base + bonus - advance - deduction).toFixed(2)),
      );

      await this.prisma.salaryRecord.upsert({
        where: { periodId_userId: { periodId, userId: u.id } },
        create: {
          companyId: period.companyId,
          periodId,
          userId: u.id,
          base,
          bonus,
          advance,
          deduction,
          total,
        },
        update: { base, advance, total },
      });
    }

    return this.listRecords(periodId, companyId);
  }

  async listRecords(periodId: string, companyId: string) {
    await this.ensurePeriod(periodId, companyId);
    const records = await this.prisma.salaryRecord.findMany({
      where: { periodId, companyId },
      include: { user: { select: { fullName: true, position: true } } },
    });
    return records
      .map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.user.fullName,
        position: r.user.position,
        base: Number(r.base),
        bonus: Number(r.bonus),
        advance: Number(r.advance),
        deduction: Number(r.deduction),
        total: Number(r.total),
        isPaid: r.isPaid,
      }))
      .sort((a, b) => b.total - a.total);
  }

  // Изменить бонус/удержание и пересчитать итог
  async updateRecord(id: string, dto: UpdateRecordDto, companyId: string) {
    const rec = await this.prisma.salaryRecord.findFirst({
      where: { id, companyId },
      include: { period: { select: { isClosed: true } } },
    });
    if (!rec) throw new NotFoundException('Запись не найдена');
    if (rec.isPaid) throw new BadRequestException('Запись уже выплачена');
    if (rec.period.isClosed) throw new BadRequestException('Период закрыт');
    const bonus = dto.bonus ?? Number(rec.bonus);
    const deduction = dto.deduction ?? Number(rec.deduction);
    // Итог не может быть отрицательным.
    const total = Math.max(
      0,
      Number(
        (Number(rec.base) + bonus - Number(rec.advance) - deduction).toFixed(2),
      ),
    );
    return this.prisma.salaryRecord.update({
      where: { id },
      data: { bonus, deduction, total },
    });
  }

  // Выплата: отметить + расход из кассы
  async pay(id: string, companyId: string, userId?: string) {
    const rec = await this.prisma.salaryRecord.findFirst({
      where: { id, companyId },
      include: {
        user: { select: { fullName: true } },
        period: { select: { isClosed: true } },
      },
    });
    if (!rec) throw new NotFoundException('Запись не найдена');
    if (rec.isPaid) throw new BadRequestException('Уже выплачено');
    if (rec.period.isClosed) throw new BadRequestException('Период закрыт');

    await this.prisma.$transaction(async (tx) => {
      await tx.salaryRecord.update({
        where: { id },
        data: { isPaid: true },
      });
      // Расход из кассы привязываем к открытой смене выплачивающего кассира
      // и категории «Зарплата» — иначе выплата не попадёт в Z-отчёт и завысит
      // остаток наличных.
      const shiftId = await this.openShiftId(tx, rec.companyId, userId);
      await tx.cashMovement.create({
        data: {
          companyId: rec.companyId,
          shiftId,
          type: 'OUT',
          amount: rec.total,
          category: 'Зарплата',
          reason: `Зарплата: ${rec.user.fullName}`,
        },
      });
    });
    return { ok: true };
  }

  // Открытая смена кассира — для привязки движений кассы к Z-отчёту.
  private async openShiftId(
    tx: any,
    companyId: string,
    userId?: string,
  ): Promise<string | undefined> {
    if (!userId) return undefined;
    const shift = await tx.cashShift.findFirst({
      where: { companyId, userId, closedAt: null },
    });
    return shift?.id;
  }

  private async ensurePeriod(id: string, companyId: string) {
    const p = await this.prisma.payrollPeriod.findFirst({
      where: { id, companyId },
    });
    if (!p) throw new NotFoundException('Период не найден');
    return p;
  }
}
