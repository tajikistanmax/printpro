import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Login required');
    }

    try {
      const payload = await this.jwt.verifyAsync(auth.slice(7));
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          companyId: true,
          roleId: true,
          login: true,
          isActive: true,
          deletedAt: true,
        },
      });

      if (
        !user ||
        !user.isActive ||
        user.deletedAt ||
        user.companyId !== payload.companyId
      ) {
        throw new UnauthorizedException('Session is no longer valid');
      }

      (req as any).user = {
        ...payload,
        sub: user.id,
        companyId: user.companyId,
        roleId: user.roleId,
        login: user.login,
      };
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Session expired, please log in again');
    }
  }
}
