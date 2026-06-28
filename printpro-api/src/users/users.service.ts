import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Создать сотрудника (пароль сохраняется в зашифрованном виде)
  async create(dto: CreateUserDto) {
    const passwordHash = await AuthService.hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        companyId: dto.companyId,
        fullName: dto.fullName,
        login: dto.login,
        passwordHash,
        roleId: dto.roleId,
        branchId: dto.branchId,
        phone: dto.phone,
        isActive: dto.isActive ?? true,
      },
      include: { role: true, branch: true },
    });
    return this.safe(user);
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
  async resetPassword(id: string, newPassword: string) {
    const exists = await this.prisma.user.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Сотрудник не найден');
    if (!newPassword || newPassword.length < 4) {
      throw new NotFoundException('Пароль слишком короткий (мин. 4 символа)');
    }
    const passwordHash = await AuthService.hashPassword(newPassword);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    return { ok: true };
  }

  // Включить/выключить сотрудника
  async setActive(id: string, isActive: boolean) {
    const exists = await this.prisma.user.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Сотрудник не найден');
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      include: { role: true, branch: true },
    });
    return this.safe(user);
  }

  // Убираем пароль из ответа
  private safe(user: any) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
