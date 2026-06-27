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
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

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
    return this.prisma.designProof.update({
      where: { id },
      data: {
        title: dto.title,
        assignedUserId: dto.assignedUserId,
        fileUrl: dto.fileUrl,
        fileName: dto.fileName,
        comment: dto.comment,
        ...(newFile
          ? { version: proof.version + 1, status: ProofStatus.IN_PROGRESS }
          : {}),
      },
      include: this.includes(),
    });
  }

  async updateStatus(id: string, dto: UpdateProofStatusDto) {
    await this.ensure(id);
    return this.prisma.designProof.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
      },
      include: this.includes(),
    });
  }

  async remove(id: string) {
    await this.ensure(id);
    await this.prisma.designProof.delete({ where: { id } });
    return { ok: true };
  }

  private includes() {
    return {
      order: {
        select: {
          id: true,
          orderNumber: true,
          client: { select: { fullName: true, phone: true } },
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
