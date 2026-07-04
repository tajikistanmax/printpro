import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, ProofStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProofDto,
  UpdateProofDto,
  UpdateProofStatusDto,
} from './dto/design.dto';

@Injectable()
export class DesignService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProofDto, companyId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, companyId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    const status = dto.fileUrl ? ProofStatus.IN_PROGRESS : ProofStatus.TODO;
    const created = await this.prisma.designProof.create({
      data: {
        companyId,
        orderId: dto.orderId,
        title: dto.title,
        assignedUserId: dto.assignedUserId,
        fileUrl: dto.fileUrl,
        fileName: dto.fileName,
        status,
      },
      include: this.includes(),
    });
    await this.syncOrderFromProof(dto.orderId, status);
    return created;
  }

  findAll(companyId: string, status?: ProofStatus, orderId?: string) {
    return this.prisma.designProof.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(orderId ? { orderId } : {}),
      },
      include: this.includes(),
      orderBy: { updatedAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdateProofDto, companyId: string) {
    const proof = await this.ensure(id, companyId);
    // Новый файл = новая версия
    const newFile = dto.fileUrl && dto.fileUrl !== proof.fileUrl;
    const updated = await this.prisma.designProof.update({
      where: { id },
      data: {
        title: dto.title,
        assignedUserId: dto.assignedUserId,
        fileUrl: dto.fileUrl,
        fileName: dto.fileName,
        comment: dto.comment,
        ...(dto.checklist !== undefined
          ? { checklist: dto.checklist }
          : {}),
        ...(newFile
          ? {
              version: proof.version + 1,
              status: ProofStatus.IN_PROGRESS,
              // Новая версия аннулирует прежнее согласование — иначе аудит
              // «кто/когда утвердил» указывал бы на устаревший файл.
              approvedById: null,
              approvedAt: null,
            }
          : {}),
      },
      include: this.includes(),
    });
    if (newFile) await this.syncOrderFromProof(proof.orderId, ProofStatus.IN_PROGRESS);
    return updated;
  }

  async updateStatus(
    id: string,
    dto: UpdateProofStatusDto,
    companyId: string,
    userId?: string,
  ) {
    const proof = await this.ensure(id, companyId);
    const updated = await this.prisma.designProof.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
        ...(dto.status === ProofStatus.APPROVED
          ? { approvedById: userId ?? null, approvedAt: new Date() }
          : {}),
      },
      include: this.includes(),
    });
    // Авто-связь: статус макета подтягивает статус заказа (только в дизайн-фазе)
    await this.syncOrderFromProof(proof.orderId, dto.status, userId);
    return updated;
  }

  // Двигаем статус заказа за статусом макета. Только пока заказ в дизайн-фазе —
  // не тянем назад заказы, уже ушедшие в производство/выдачу.
  private async syncOrderFromProof(
    orderId: string,
    proofStatus: ProofStatus,
    userId?: string,
  ) {
    const map: Partial<Record<ProofStatus, OrderStatus>> = {
      IN_PROGRESS: OrderStatus.IN_DESIGN,
      SENT: OrderStatus.DESIGN_APPROVAL,
      APPROVED: OrderStatus.DESIGN_APPROVED,
      REVISION: OrderStatus.IN_DESIGN,
    };
    const target = map[proofStatus];
    if (!target) return;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!order) return;
    const designPhase: OrderStatus[] = [
      OrderStatus.ACCEPTED,
      OrderStatus.AWAITING_DESIGN,
      OrderStatus.IN_DESIGN,
      OrderStatus.DESIGN_APPROVAL,
      OrderStatus.DESIGN_APPROVED,
    ];
    if (!designPhase.includes(order.status) || order.status === target) return;
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: target },
    });
    await this.prisma.orderStatusHistory.create({
      data: {
        orderId,
        status: target,
        reason: 'Авто: статус макета',
        ...(userId ? { userId } : {}),
      },
    });
  }

  async remove(id: string, companyId: string) {
    await this.ensure(id, companyId);
    // Мягкое удаление — чтобы синхронизировалось между узлами
    await this.prisma.designProof.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  private includes() {
    return {
      order: {
        select: {
          id: true,
          orderNumber: true,
          orderType: true,
          total: true,
          deadline: true,
          createdAt: true,
          client: { select: { fullName: true, phone: true, type: true } },
          assignedUser: { select: { fullName: true } },
          items: { select: { description: true, quantity: true }, take: 1 },
        },
      },
      assignedUser: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
    };
  }

  // Проверка владельца: макет должен принадлежать компании из токена
  private async ensure(id: string, companyId: string) {
    const p = await this.prisma.designProof.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!p) throw new NotFoundException('Макет не найден');
    return p;
  }
}
