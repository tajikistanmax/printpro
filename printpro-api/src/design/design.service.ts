import { Injectable, NotFoundException } from '@nestjs/common';
import { ProofStatus } from '@prisma/client';
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
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, companyId: dto.companyId, deletedAt: null },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    await this.ensureAssignedUser(dto.companyId, dto.assignedUserId);

    return this.prisma.designProof.create({
      data: {
        companyId: dto.companyId,
        orderId: dto.orderId,
        title: dto.title,
        assignedUserId: dto.assignedUserId,
        fileUrl: dto.fileUrl,
        fileName: dto.fileName,
        status: dto.fileUrl ? ProofStatus.IN_PROGRESS : ProofStatus.TODO,
      },
      include: this.includes(),
    });
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

  async update(id: string, companyId: string, dto: UpdateProofDto) {
    const proof = await this.ensure(id, companyId);
    await this.ensureAssignedUser(companyId, dto.assignedUserId);
    // Новый файл = новая версия
    const newFile = dto.fileUrl && dto.fileUrl !== proof.fileUrl;
    return this.prisma.designProof.update({
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
  }

  async updateStatus(id: string, companyId: string, dto: UpdateProofStatusDto) {
    await this.ensure(id, companyId);
    return this.prisma.designProof.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
      },
      include: this.includes(),
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
    };
  }

  private async ensure(id: string, companyId: string) {
    const p = await this.prisma.designProof.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!p) throw new NotFoundException('Макет не найден');
    return p;
  }

  private async ensureAssignedUser(companyId: string, userId?: string) {
    if (!userId) return;
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Assigned user not found');
  }
}
