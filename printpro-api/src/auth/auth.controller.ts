import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { PosLoginDto } from './dto/pos-login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // POST /api/auth/login — вход по логину/паролю
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // POST /api/auth/pos-login — быстрый вход кассира по PIN (токен 12ч)
  @Post('pos-login')
  posLogin(@Body() dto: PosLoginDto) {
    return this.auth.posLogin(dto.companyId, dto.pin);
  }

  // GET /api/auth/me — кто я и какие у меня права (нужен токен)
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: { sub: string }) {
    return this.auth.me(user.sub);
  }
}
