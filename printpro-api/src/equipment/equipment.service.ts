import { Injectable, NotFoundException } from '@nestjs/common';
import { EquipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEquipmentDto, UpdateEquipmentDto } from './dto/equipment.dto';

@Injectable()
export class EquipmentService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureBranch(companyId: string, branchId?: string | null) {
    if (!branchId) return;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
  }

  async create(dto: CreateEquipmentDto) {
    await this.ensureBranch(dto.companyId, dto.branchId);
    return this.prisma.equipment.create({
      data: {
        companyId: dto.companyId,
        branchId: dto.branchId,
        name: dto.name,
        type: dto.type,
        model: dto.model,
        serial: dto.serial,
        status: dto.status ?? EquipmentStatus.ACTIVE,
        note: dto.note,
      },
      include: this.includes(),
    });
  }

  findAll(companyId: string, status?: EquipmentStatus) {
    return this.prisma.equipment.findMany({
      where: { companyId, deletedAt: null, ...(status ? { status } : {}) },
      include: this.includes(),
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
  }

  async update(id: string, companyId: string, dto: UpdateEquipmentDto) {
    await this.ensure(id, companyId);
    await this.ensureBranch(companyId, dto.branchId);
    return this.prisma.equipment.update({
      where: { id },
      data: dto,
      include: this.includes(),
    });
  }

  async remove(id: string, companyId: string) {
    await this.ensure(id, companyId);
    // Мягкое удаление — чтобы синхронизировалось между узлами
    await this.prisma.equipment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  private includes() {
    return { branch: { select: { id: true, name: true } } };
  }

  private async ensure(id: string, companyId: string) {
    const e = await this.prisma.equipment.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!e) throw new NotFoundException('Оборудование не найдено');
    return e;
  }
}
