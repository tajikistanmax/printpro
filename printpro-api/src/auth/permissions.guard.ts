import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS_KEY } from './permissions.decorator';

// Проверяет, что у роли пользователя есть нужные права.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Если на маршруте не указаны права — пускаем (нужен только вход).
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.roleId) {
      throw new ForbiddenException('Роль не назначена — доступ запрещён');
    }

    // Загружаем права роли из базы
    const rolePerms = await this.prisma.rolePermission.findMany({
      where: { roleId: user.roleId },
      include: { permission: true },
    });
    const codes = new Set(rolePerms.map((rp) => rp.permission.code));

    // Несколько кодов в @RequirePermissions = достаточно ЛЮБОГО из них (ИЛИ):
    // так один маршрут (например, каталог товаров) доступен и складу, и кассе.
    const ok = required.some((code) => codes.has(code));
    if (!ok) {
      throw new ForbiddenException('Недостаточно прав для этого действия');
    }
    return true;
  }
}
