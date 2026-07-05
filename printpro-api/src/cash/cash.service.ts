import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CloseShiftDto, OpenShiftDto, CashMovementDto } from './dto/cash.dto';
import { docNumber } from '../common/doc-number';
import { nextSeq } from '../common/next-number';

@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Открыть смену ----------
  private async assertBranch(companyId: string, branchId?: string | null) {
    if (!branchId) return;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
  }

  async openShift(companyId: string, userId: string, dto: OpenShiftDto) {
    await this.assertBranch(companyId, dto.branchId);
    // У одного кассира не может быть двух открытых смен
    const open = await this.prisma.cashShift.findFirst({
      where: { companyId, userId, closedAt: null, deletedAt: null },
    });
    if (open) {
      throw new BadRequestException('У вас уже есть открытая смена');
    }
    const smenaSeq = await nextSeq(this.prisma, companyId, 'SMENA');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const shift = await tx.cashShift.create({
          data: {
            companyId,
            number: docNumber('SMENA', smenaSeq),
            userId,
            branchId: dto.branchId,
            openingBalance: dto.openingBalance ?? 0,
          },
        });
        // Аудит открытия смены (P1-9d)
        await this.audit.recordTx(tx, {
          companyId,
          userId,
          action: 'money:shift-open',
          entity: 'cashShift',
          entityId: shift.id,
          after: {
            number: shift.number,
            branchId: shift.branchId,
            openingBalance: Number(shift.openingBalance),
          },
        });
        return shift;
      });
    } catch (e) {
      // Гонка: частичный уникальный индекс «одна открытая смена на кассира»
      // (CashShift_companyId_userId_open_key) не дал открыть вторую смену.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('У вас уже есть открытая смена');
      }
      throw e;
    }
  }

  // ---------- Текущая открытая смена пользователя ----------
  async currentShift(companyId: string, userId: string) {
    const shift = await this.prisma.cashShift.findFirst({
      where: { companyId, userId, closedAt: null, deletedAt: null },
      orderBy: { openedAt: 'desc' },
    });
    if (!shift) return null;
    return this.report(shift.id, companyId);
  }

  // ---------- Закрыть смену ----------
  async closeShift(
    companyId: string,
    userId: string,
    shiftId: string,
    dto: CloseShiftDto,
  ) {
    // Политика владения: закрыть смену может только тот кассир, которому она
    // принадлежит (кроме companyId проверяем userId). Менеджерское закрытие
    // чужой смены потребует отдельного права cash.manage (см. schemaChanges).
    const shift = await this.prisma.cashShift.findFirst({
      where: { id: shiftId, companyId, userId, deletedAt: null },
    });
    if (!shift) throw new NotFoundException('Смена не найдена');
    if (shift.closedAt) throw new BadRequestException('Смена уже закрыта');

    const report = await this.report(shiftId, companyId);
    const expected = report.summary.expectedCash;
    const closingBalance =
      dto.countedBalance !== undefined ? dto.countedBalance : expected;

    await this.prisma.$transaction(async (tx) => {
      await tx.cashShift.update({
        where: { id: shiftId },
        data: { closedAt: new Date(), closingBalance },
      });
      // Аудит закрытия смены со снимком расчётного/фактического остатка (P1-9d)
      await this.audit.recordTx(tx, {
        companyId,
        userId,
        action: 'money:shift-close',
        entity: 'cashShift',
        entityId: shiftId,
        before: { openingBalance: Number(shift.openingBalance) },
        after: {
          expectedCash: expected,
          countedBalance: dto.countedBalance ?? null,
          closingBalance: Number(closingBalance),
        },
      });
    });
    return this.report(shiftId, companyId);
  }

  // ---------- Внести / изъять деньги ----------
  async addMovement(companyId: string, userId: string, dto: CashMovementDto) {
    let shiftId = dto.shiftId;
    if (!shiftId) {
      const open = await this.prisma.cashShift.findFirst({
        where: { companyId, userId, closedAt: null, deletedAt: null },
      });
      if (!open) {
        throw new BadRequestException(
          'Нет открытой смены — сначала откройте кассу',
        );
      }
      shiftId = open.id;
    } else {
      // Явно переданный shiftId должен указывать на СВОЮ открытую смену того же
      // кассира (companyId + userId + closedAt: null) — иначе движение можно было
      // бы привязать к чужой или закрытой смене.
      const shift = await this.prisma.cashShift.findFirst({
        where: { id: shiftId, companyId, userId, closedAt: null, deletedAt: null },
        select: { id: true },
      });
      if (!shift) throw new NotFoundException('Open shift not found');
    }
    await this.prisma.$transaction(async (tx) => {
      const mv = await tx.cashMovement.create({
        data: {
          companyId,
          shiftId,
          type: dto.type,
          amount: dto.amount,
          category: dto.category,
          reason: dto.reason,
        },
      });
      // Аудит движения по кассе IN/OUT (P1-9d)
      await this.audit.recordTx(tx, {
        companyId,
        userId,
        action: 'money:cash-movement',
        entity: 'cashMovement',
        entityId: mv.id,
        after: {
          shiftId,
          type: dto.type,
          amount: Number(dto.amount),
          category: dto.category ?? null,
          reason: dto.reason ?? null,
        },
      });
    });
    return this.report(shiftId, companyId);
  }

  // ---------- История смен ----------
  async listShifts(companyId: string) {
    const shifts = await this.prisma.cashShift.findMany({
      where: { companyId, deletedAt: null },
      include: {
        user: { select: { id: true, fullName: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
    });
    return shifts.map((s) => ({
      id: s.id,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      isOpen: s.closedAt === null,
      user: s.user?.fullName ?? '',
      branch: s.branch?.name ?? null,
      openingBalance: Number(s.openingBalance),
      closingBalance: s.closingBalance !== null ? Number(s.closingBalance) : null,
    }));
  }

  // ---------- Отчёт по смене (X/Z-отчёт) ----------
  // companyId обязателен: отчёт всегда ограничен своей компанией (tenant-изоляция).
  // Чтение отчёта доступно любому с правом cash.view в рамках компании —
  // это нужно надзорным ролям (Бухгалтер/Директор) для просмотра Z-отчёта
  // по любой смене; ограничение по конкретному кассиру потребует cash.manage.
  async report(shiftId: string, companyId: string) {
    const shift = await this.prisma.cashShift.findFirst({
      where: { id: shiftId, companyId, deletedAt: null },
      include: {
        user: { select: { id: true, fullName: true } },
        branch: { select: { id: true, name: true } },
        payments: {
          where: { deletedAt: null },
          include: {
            order: { select: { orderNumber: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        movements: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!shift) throw new NotFoundException('Смена не найдена');

    // Суммы оплат по способам
    const byMethod: Record<PaymentMethod, number> = {
      CASH: 0,
      CARD: 0,
      QR: 0,
      TRANSFER: 0,
      DEBT: 0,
    };
    for (const p of shift.payments) {
      byMethod[p.method] = Number(
        (byMethod[p.method] + Number(p.amount)).toFixed(2),
      );
    }

    // Движения по кассе (внесения/изъятия)
    const movementsIn = shift.movements
      .filter((m) => m.type === 'IN')
      .reduce((s, m) => s + Number(m.amount), 0);
    const movementsOut = shift.movements
      .filter((m) => m.type === 'OUT')
      .reduce((s, m) => s + Number(m.amount), 0);

    const opening = Number(shift.openingBalance);
    // Расчётный остаток наличных = старт + наличная выручка + внесения − изъятия
    const expectedCash = Number(
      (opening + byMethod.CASH + movementsIn - movementsOut).toFixed(2),
    );

    const totalRevenue = Number(
      (byMethod.CASH + byMethod.CARD + byMethod.QR + byMethod.TRANSFER).toFixed(
        2,
      ),
    );

    return {
      id: shift.id,
      number: shift.number,
      isOpen: shift.closedAt === null,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      user: shift.user?.fullName ?? '',
      branch: shift.branch?.name ?? null,
      summary: {
        openingBalance: opening,
        closingBalance:
          shift.closingBalance !== null ? Number(shift.closingBalance) : null,
        cash: byMethod.CASH,
        card: byMethod.CARD,
        qr: byMethod.QR,
        transfer: byMethod.TRANSFER,
        debt: byMethod.DEBT,
        movementsIn: Number(movementsIn.toFixed(2)),
        movementsOut: Number(movementsOut.toFixed(2)),
        totalRevenue, // выручка деньгами (без долгов)
        expectedCash, // сколько наличных должно быть в кассе
        paymentsCount: shift.payments.length,
      },
      payments: shift.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        orderNumber: p.order?.orderNumber ?? null,
        createdAt: p.createdAt,
      })),
      movements: shift.movements.map((m) => ({
        id: m.id,
        type: m.type,
        amount: Number(m.amount),
        category: m.category,
        reason: m.reason,
        createdAt: m.createdAt,
      })),
    };
  }
}
