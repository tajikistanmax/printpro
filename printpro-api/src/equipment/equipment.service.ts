import { Injectable, NotFoundException } from '@nestjs/common';
import { EquipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEquipmentDto, UpdateEquipmentDto } from './dto/equipment.dto';

@Injectable()
export class EquipmentService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateEquipmentDto) {
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

  async update(id: string, dto: UpdateEquipmentDto) {
    await this.ensure(id);
    return this.prisma.equipment.update({
      where: { id },
      data: dto,
      include: this.includes(),
    });
  }

  async remove(id: string) {
    await this.ensure(id);
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

  private async ensure(id: string) {
    const e = await this.prisma.equipment.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Оборудование не найдено');
    return e;
  }
}
