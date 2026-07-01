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

  // Быстрый вход на кассе по PIN. Токен со сроком 12ч и меткой src=pos.
  // Пользователь не вводит логин — определяем его по совпадению PIN среди
  // активных сотрудников компании.
  async posLogin(companyId: string, pin: string) {
    if (!companyId || !/^\d{4,6}$/.test(pin ?? '')) {
      throw new UnauthorizedException('Неверный PIN');
    }
    const users = await this.prisma.user.findMany({
      where: { companyId, isActive: true, pinHash: { not: null } },
      include: { role: true },
    });

    let matched: (typeof users)[number] | null = null;
    for (const u of users) {
      if (u.pinHash && (await bcrypt.compare(pin, u.pinHash))) {
        matched = u;
        break;
      }
    }
    if (!matched) throw new UnauthorizedException('Неверный PIN');

    const payload = {
      sub: matched.id,
      companyId: matched.companyId,
      roleId: matched.roleId,
      login: matched.login,
      src: 'pos',
    };
    const token = await this.jwt.signAsync(payload, { expiresIn: '12h' });

    return {
      token,
      user: {
        id: matched.id,
        fullName: matched.fullName,
        login: matched.login,
        role: matched.role?.name ?? null,
        roleId: matched.roleId,
        branchId: matched.branchId,
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
