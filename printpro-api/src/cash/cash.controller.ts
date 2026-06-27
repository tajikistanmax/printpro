import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CashService } from './cash.service';
import { CloseShiftDto, OpenShiftDto, CashMovementDto } from './dto/cash.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

// Данные пользователя из токена (см. auth.service: payload)
interface JwtUser {
  sub: string;
  companyId: string;
  roleId?: string;
  login?: string;
}

@Controller('cash')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CashController {
  constructor(private readonly cash: CashService) {}

  // Текущая открытая смена (или null)
  @Get('current')
  @RequirePermissions('cash.view')
  current(@CurrentUser() user: JwtUser) {
    return this.cash.currentShift(user.companyId, user.sub);
  }

  // История смен
  @Get('shifts')
  @RequirePermissions('cash.view')
  shifts(@CurrentUser() user: JwtUser) {
    return this.cash.listShifts(user.companyId);
  }

  // Отчёт по конкретной смене
  @Get('shifts/:id/report')
  @RequirePermissions('cash.view')
  report(@Param('id') id: string) {
    return this.cash.report(id);
  }

  // Открыть смену
  @Post('shifts/open')
  @RequirePermissions('cash.operate')
  open(@CurrentUser() user: JwtUser, @Body() dto: OpenShiftDto) {
    return this.cash.openShift(user.companyId, user.sub, dto);
  }

  // Закрыть смену
  @Post('shifts/:id/close')
  @RequirePermissions('cash.operate')
  close(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.cash.closeShift(user.companyId, user.sub, id, dto);
  }

  // Внести / изъять деньги
  @Post('movements')
  @RequirePermissions('cash.operate')
  movement(@CurrentUser() user: JwtUser, @Body() dto: CashMovementDto) {
    return this.cash.addMovement(user.companyId, user.sub, dto);
  }
}
