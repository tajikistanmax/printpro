import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  // Весь справочник прав (для отрисовки галочек в интерфейсе)
  allPermissions() {
    return this.prisma.permission.findMany({ orderBy: { group: 'asc' } });
  }

  // Создать роль
  createRole(dto: CreateRoleDto) {
    return this.prisma.role.create({ data: dto });
  }

  // Роли компании с их правами
  findRoles(companyId: string) {
    return this.prisma.role.findMany({
      where: { companyId },
      include: { permissions: { include: { permission: true } } },
    });
  }

  // Установить права роли (полная замена набора) — «галочки»
  async setPermissions(roleId: string, permissionCodes: string[]) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Роль не найдена');

    // Находим id выбранных прав по их кодам
    const perms = await this.prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
    });

    // Заменяем: удаляем старые связи, ставим новые
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId, permissionId: p.id })),
      }),
    ]);

    return this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
  }
}
