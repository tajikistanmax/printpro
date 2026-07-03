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

  async create(dto: CreateProofDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    const status = dto.fileUrl ? ProofStatus.IN_PROGRESS : ProofStatus.TODO;
    const created = await this.prisma.designProof.create({
      data: {
        companyId: dto.companyId,
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

  async update(id: string, dto: UpdateProofDto) {
    const proof = await this.ensure(id);
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
          ? { version: proof.version + 1, status: ProofStatus.IN_PROGRESS }
          : {}),
      },
      include: this.includes(),
    });
    if (newFile) await this.syncOrderFromProof(proof.orderId, ProofStatus.IN_PROGRESS);
    return updated;
  }

  async updateStatus(id: string, dto: UpdateProofStatusDto) {
    const proof = await this.ensure(id);
    const updated = await this.prisma.designProof.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
      },
      include: this.includes(),
    });
    // Авто-связь: статус макета подтягивает статус заказа (только в дизайн-фазе)
    await this.syncOrderFromProof(proof.orderId, dto.status);
    return updated;
  }

  // Двигаем статус заказа за статусом макета. Только пока заказ в дизайн-фазе —
  // не тянем назад заказы, уже ушедшие в производство/выдачу.
  private async syncOrderFromProof(orderId: string, proofStatus: ProofStatus) {
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
      data: { orderId, status: target, reason: 'Авто: статус макета' },
    });
  }

  async remove(id: string) {
    await this.ensure(id);
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
    };
  }

  private async ensure(id: string) {
    const p = await this.prisma.designProof.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Макет не найден');
    return p;
  }
}
