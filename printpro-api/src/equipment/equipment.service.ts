import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EquipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEquipmentDto, UpdateEquipmentDto } from './dto/equipment.dto';

@Injectable()
export class EquipmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEquipmentDto, companyId: string) {
    await this.ensureBranch(dto.branchId, companyId);
    return this.prisma.equipment.create({
      data: {
        companyId,
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

  async update(id: string, dto: UpdateEquipmentDto, companyId: string) {
    await this.ensure(id, companyId);
    await this.ensureBranch(dto.branchId, companyId);
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

  // Проверка владельца: оборудование должно принадлежать компании из токена
  private async ensure(id: string, companyId: string) {
    const e = await this.prisma.equipment.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!e) throw new NotFoundException('Оборудование не найдено');
    return e;
  }

  // Филиал (если указан) тоже должен принадлежать компании
  private async ensureBranch(
    branchId: string | undefined,
    companyId: string,
  ) {
    if (!branchId) return;
    const b = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
    });
    if (!b) throw new BadRequestException('Филиал не найден');
  }
}
