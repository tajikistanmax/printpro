import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

// Проверяет, что в запросе есть действительный токен входа.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Нужен вход в систему');
    }
    const token = auth.slice(7);
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }
    // Деактивированный сотрудник не должен работать до истечения токена:
    // сверяем isActive при каждом запросе (аналогично правам в PermissionsGuard).
    if (payload?.sub) {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isActive: true, deletedAt: true },
      });
      if (!user || user.deletedAt || user.isActive === false) {
        throw new UnauthorizedException('Доступ отключён — обратитесь к администратору');
      }
    }
    // Кладём данные пользователя в запрос — дальше доступны через @CurrentUser
    (req as any).user = payload;
    return true;
  }
}
