import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Создать сотрудника (пароль и PIN сохраняются в зашифрованном виде)
  async create(dto: CreateUserDto, actorId?: string) {
    // Защита от повышения привилегий: роль должна принадлежать компании
    // текущего пользователя, иначе можно назначить чужую (например, админскую) роль.
    if (dto.roleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: dto.roleId, companyId: dto.companyId },
        select: { id: true },
      });
      if (!role) throw new BadRequestException('Недопустимая роль');
    }
    const passwordHash = await AuthService.hashPassword(dto.password);
    const pinHash = dto.pin ? await AuthService.hashPassword(dto.pin) : null;
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          companyId: dto.companyId,
          fullName: dto.fullName,
          login: dto.login,
          passwordHash,
          pinHash,
          roleId: dto.roleId,
          branchId: dto.branchId,
          phone: dto.phone,
          isActive: dto.isActive ?? true,
        },
        include: { role: true, branch: true },
      });
      // Аудит создания сотрудника (P1-9d) — кто, кого, с какой ролью/доступом
      await this.audit.recordTx(tx, {
        companyId: dto.companyId,
        userId: actorId,
        action: 'rbac:user-create',
        entity: 'user',
        entityId: created.id,
        after: {
          login: created.login,
          roleId: created.roleId,
          isActive: created.isActive,
          hasPin: !!pinHash,
        },
      });
      return created;
    });
    return this.safe(user);
  }

  // Установить / сбросить PIN кассира (админом). Пустой PIN — убрать доступ по PIN.
  async setPin(
    id: string,
    pin: string | null,
    companyId: string,
    actorId?: string,
  ) {
    const exists = await this.prisma.user.findFirst({
      where: { id, companyId },
      select: { id: true, pinHash: true },
    });
    if (!exists) throw new NotFoundException('Сотрудник не найден');
    let pinHash: string | null = null;
    if (pin) {
      if (!/^\d{4,6}$/.test(pin)) {
        throw new NotFoundException('PIN должен быть 4–6 цифр');
      }
      pinHash = await AuthService.hashPassword(pin);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { pinHash } });
      await this.audit.recordTx(tx, {
        companyId,
        userId: actorId,
        action: 'rbac:user-pin',
        entity: 'user',
        entityId: id,
        before: { hasPin: !!exists.pinHash },
        after: { hasPin: !!pinHash },
      });
    });
    return { ok: true, hasPin: !!pinHash };
  }

  // Список сотрудников компании
  async findAll(companyId: string) {
    const users = await this.prisma.user.findMany({
      where: { companyId },
      include: { role: true, branch: true },
      orderBy: { fullName: 'asc' },
    });
    return users.map((u) => this.safe(u));
  }

  // Сбросить пароль сотрудника (админом)
  async resetPassword(
    id: string,
    newPassword: string,
    companyId: string,
    actorId?: string,
  ) {
    const exists = await this.prisma.user.findFirst({
      where: { id, companyId },
    });
    if (!exists) throw new NotFoundException('Сотрудник не найден');
    if (!newPassword || newPassword.length < 4) {
      throw new NotFoundException('Пароль слишком короткий (мин. 4 символа)');
    }
    const passwordHash = await AuthService.hashPassword(newPassword);
    // Инкремент tokenVersion отзывает все ранее выданные токены сотрудника
    // (старые сессии перестают проходить guard). (P1-8)
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      // Аудит сброса пароля = отзыв сессий (P1-9d). Пароль не логируем.
      await this.audit.recordTx(tx, {
        companyId,
        userId: actorId,
        action: 'rbac:user-password-reset',
        entity: 'user',
        entityId: id,
        after: { sessionsRevoked: true },
      });
    });
    return { ok: true };
  }

  // Включить/выключить сотрудника
  async setActive(
    id: string,
    isActive: boolean,
    companyId: string,
    actorId?: string,
  ) {
    const exists = await this.prisma.user.findFirst({
      where: { id, companyId },
    });
    if (!exists) throw new NotFoundException('Сотрудник не найден');
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { isActive },
        include: { role: true, branch: true },
      });
      // Аудит вкл/выкл сотрудника (P1-9d)
      await this.audit.recordTx(tx, {
        companyId,
        userId: actorId,
        action: 'rbac:user-active',
        entity: 'user',
        entityId: id,
        before: { isActive: exists.isActive },
        after: { isActive: updated.isActive },
      });
      return updated;
    });
    return this.safe(user);
  }

  // Убираем секреты из ответа, добавляем флаг наличия PIN
  private safe(user: any) {
    const { passwordHash, pinHash, ...rest } = user;
    return { ...rest, hasPin: !!pinHash };
  }
}
