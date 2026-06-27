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
  setSalary(userId: string, dto: SetSalaryDto) {
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
    return this.prisma.payrollPeriod.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
  }

  listPeriods(companyId: string) {
    return this.prisma.payrollPeriod.findMany({
      where: { companyId },
      orderBy: { startDate: 'desc' },
    });
  }

  async closePeriod(id: string) {
    await this.ensurePeriod(id);
    return this.prisma.payrollPeriod.update({
      where: { id },
      data: { isClosed: true },
    });
  }

  // ---------- Расчёт зарплаты за период ----------
  async calculate(periodId: string) {
    const period = await this.ensurePeriod(periodId);
    if (period.isClosed) {
      throw new BadRequestException('Период закрыт');
    }

    const users = await this.prisma.user.findMany({
      where: { companyId: period.companyId, isActive: true },
    });

    for (const u of users) {
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
      const existing = await this.prisma.salaryRecord.findUnique({
        where: { periodId_userId: { periodId, userId: u.id } },
      });
      const bonus = existing ? Number(existing.bonus) : 0;
      const deduction = existing ? Number(existing.deduction) : 0;
      const total = Number((base + bonus - advance - deduction).toFixed(2));

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

    return this.listRecords(periodId);
  }

  async listRecords(periodId: string) {
    const records = await this.prisma.salaryRecord.findMany({
      where: { periodId },
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
  async updateRecord(id: string, dto: UpdateRecordDto) {
    const rec = await this.prisma.salaryRecord.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Запись не найдена');
    const bonus = dto.bonus ?? Number(rec.bonus);
    const deduction = dto.deduction ?? Number(rec.deduction);
    const total = Number(
      (Number(rec.base) + bonus - Number(rec.advance) - deduction).toFixed(2),
    );
    return this.prisma.salaryRecord.update({
      where: { id },
      data: { bonus, deduction, total },
    });
  }

  // Выплата: отметить + расход из кассы
  async pay(id: string) {
    const rec = await this.prisma.salaryRecord.findUnique({
      where: { id },
      include: { user: { select: { fullName: true } } },
    });
    if (!rec) throw new NotFoundException('Запись не найдена');
    if (rec.isPaid) throw new BadRequestException('Уже выплачено');

    await this.prisma.$transaction([
      this.prisma.salaryRecord.update({
        where: { id },
        data: { isPaid: true },
      }),
      this.prisma.cashMovement.create({
        data: {
          companyId: rec.companyId,
          type: 'OUT',
          amount: rec.total,
          reason: `Зарплата: ${rec.user.fullName}`,
        },
      }),
    ]);
    return { ok: true };
  }

  private async ensurePeriod(id: string) {
    const p = await this.prisma.payrollPeriod.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Период не найден');
    return p;
  }
}
