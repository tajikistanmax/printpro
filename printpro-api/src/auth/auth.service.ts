import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Вход: проверяем логин/пароль и выдаём токен
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { companyId_login: { companyId: dto.companyId, login: dto.login } },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const payload = {
      sub: user.id,
      companyId: user.companyId,
      roleId: user.roleId,
      login: user.login,
    };
    const token = await this.jwt.signAsync(payload);

    return {
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        login: user.login,
        role: user.role?.name ?? null,
        roleId: user.roleId,
        branchId: user.branchId,
      },
    };
  }

  // Данные текущего пользователя + его права
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        branch: true,
      },
    });
    if (!user) throw new UnauthorizedException();

    return {
      id: user.id,
      fullName: user.fullName,
      login: user.login,
      role: user.role?.name ?? null,
      branch: user.branch?.name ?? null,
      permissions:
        user.role?.permissions.map((p) => p.permission.code) ?? [],
    };
  }

  // Утилита: захешировать пароль
  static hashPassword(plain: string) {
    return bcrypt.hash(plain, 10);
  }
}
