import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Весь справочник прав (для отрисовки галочек в интерфейсе)
  allPermissions() {
    return this.prisma.permission.findMany({ orderBy: { group: 'asc' } });
  }

  // Создать роль (с транзакционным аудитом — P1-9d)
  createRole(dto: CreateRoleDto & { companyId: string }, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: dto });
      await this.audit.recordTx(tx, {
        companyId: dto.companyId,
        userId: actorId,
        action: 'rbac:role-create',
        entity: 'role',
        entityId: role.id,
        after: { name: role.name, isSystem: role.isSystem },
      });
      return role;
    });
  }

  // Роли компании с их правами
  findRoles(companyId: string) {
    return this.prisma.role.findMany({
      where: { companyId },
      include: { permissions: { include: { permission: true } } },
    });
  }

  // Установить права роли (полная замена набора) — «галочки»
  async setPermissions(
    roleId: string,
    companyId: string,
    permissionCodes: string[],
    actorId?: string,
  ) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, companyId },
    });
    if (!role) throw new NotFoundException('Роль не найдена');

    // Системные роли меняются только через seed/миграцию, не через API
    if (role.isSystem) {
      throw new ForbiddenException('Системную роль нельзя изменять');
    }

    // Находим id выбранных прав по их кодам
    const perms = await this.prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
    });

    // Снимок ДО: текущий набор кодов прав роли (для аудита before/after — P1-9d)
    const beforeLinks = await this.prisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: { select: { code: true } } },
    });
    const beforeCodes = beforeLinks.map((l) => l.permission.code).sort();
    const afterCodes = perms.map((p) => p.code).sort();

    // Заменяем: удаляем старые связи, ставим новые + пишем аудит в той же tx
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: perms.map((p) => ({ roleId, permissionId: p.id })),
      });
      await this.audit.recordTx(tx, {
        companyId,
        userId: actorId,
        action: 'rbac:role-permissions',
        entity: 'role',
        entityId: roleId,
        before: { codes: beforeCodes },
        after: { codes: afterCodes },
      });
    });

    return this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
  }
}
