import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// Данные пользователя из токена (см. auth.service: payload)
interface JwtUser {
  sub: string;
  companyId: string;
  roleId?: string;
  login?: string;
}

// Ключ настройки, в котором хранится секретный токен пары «касса ↔ второй экран».
// Один токен на компанию (не на кассу), лежит в существующей таблице Setting.
const DISPLAY_TOKEN_KEY = 'displayToken';

// Ключ дисплея по умолчанию, если касса/дисплей не передали свой.
const DEFAULT_DISPLAY_KEY = '1';

// Тело POST /display/state. `state` — произвольный JSON (последнее DisplayState).
// whitelist глобального ValidationPipe отбрасывает лишние верхнеуровневые поля,
// но НЕ трогает внутренние ключи `state` (нет @ValidateNested) — то, что нужно.
class DisplayStateDto {
  @IsOptional() @IsString() key?: string;
  @IsObject() state: Record<string, unknown>;
}

/**
 * Релей состояния второго экрана покупателя ДЛЯ ОТДЕЛЬНОГО КОМПЬЮТЕРА.
 *
 * Касса (авторизованная) публикует текущее состояние корзины/оплаты в память
 * сервера, а страница /customer-display на другом ПК опрашивает его по сети,
 * предъявляя companyId + секретный токен компании.
 *
 * Состояние храним В ПАМЯТИ процесса (Map по ключу `${companyId}:${key}`) —
 * это эфемерная «текущая корзина», которую касса перезаписывает ~ежесекундно,
 * БД тут не нужна. ВНИМАНИЕ: in-memory не переживёт рестарт процесса и не
 * шарится между инстансами облака (для коробки это один процесс — ОК).
 */
@Controller('display')
export class DisplayController {
  constructor(private readonly prisma: PrismaService) {}

  // Последнее состояние на компанию+ключ. Живёт только в этом процессе.
  private static readonly stateStore = new Map<string, unknown>();

  private static storeKey(companyId: string, key?: string): string {
    return `${companyId}:${key || DEFAULT_DISPLAY_KEY}`;
  }

  // ---- ЗАЩИЩЁННЫЙ: касса публикует состояние ----------------------------
  // companyId берём ТОЛЬКО из токена (не из тела) — иначе касса одной компании
  // могла бы писать на дисплей другой. Особого права не требуем: публиковать
  // корзину вправе любой авторизованный кассир (PermissionsGuard без
  // @RequirePermissions пропускает при валидном входе).
  @Post('state')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  publish(@CurrentUser() user: JwtUser, @Body() dto: DisplayStateDto) {
    DisplayController.stateStore.set(
      DisplayController.storeKey(user.companyId, dto.key),
      dto.state,
    );
    return { ok: true };
  }

  // ---- ПУБЛИЧНЫЙ: дисплей опрашивает состояние (без входа) ---------------
  // Требуем companyId + верный token. Нет companyId/token — тихо { state: null }
  // (как public/services при отсутствии companyId, P0-12). Токен не совпал —
  // тоже тихо null, чтобы не подтверждать существование компании и не отдавать
  // чужие названия/цены/итог. Токен сверяем с Setting `displayToken` компании.
  @Get('state')
  async read(
    @Query('companyId') companyId: string,
    @Query('key') key: string,
    @Query('token') token: string,
  ) {
    if (!companyId || !token) return { state: null };
    const setting = await this.prisma.setting.findFirst({
      where: { companyId, key: DISPLAY_TOKEN_KEY },
      select: { value: true },
    });
    if (!setting?.value || setting.value !== token) return { state: null };
    const state =
      DisplayController.stateStore.get(
        DisplayController.storeKey(companyId, key),
      ) ?? null;
    return { state };
  }

  // ---- ЗАЩИЩЁННЫЙ: получить/создать токен пары для компании --------------
  // companyId из токена. Идемпотентно: если токен уже есть — возвращаем его,
  // иначе генерируем криптослучайный и сохраняем в Setting.
  @Get('pairing')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  async pairing(@CurrentUser() user: JwtUser) {
    const existing = await this.prisma.setting.findFirst({
      where: { companyId: user.companyId, key: DISPLAY_TOKEN_KEY },
      select: { value: true },
    });
    if (existing?.value) return { token: existing.value };

    const token = randomBytes(16).toString('hex');
    // upsert по уникальному (companyId, key): устойчиво к гонке двух вкладок,
    // одновременно запросивших pairing (обе получат один сохранённый токен).
    const saved = await this.prisma.setting.upsert({
      where: {
        companyId_key: { companyId: user.companyId, key: DISPLAY_TOKEN_KEY },
      },
      create: { companyId: user.companyId, key: DISPLAY_TOKEN_KEY, value: token },
      update: {},
      select: { value: true },
    });
    return { token: saved.value ?? token };
  }
}
