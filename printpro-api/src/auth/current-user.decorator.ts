import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Достаёт текущего пользователя (из токена) в параметр метода.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest().user;
  },
);
