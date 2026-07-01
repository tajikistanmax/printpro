import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import {
  AddAdvanceDto,
  AddWorkTimeDto,
  CreatePeriodDto,
  SetSalaryDto,
  UpdateRecordDto,
} from './dto/payroll.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('payroll')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  // Ставки сотрудников
  @Get('staff')
  @RequirePermissions('payroll.view')
  staff(@CurrentUser() user: { sub: string; companyId: string }) {
    return this.payroll.staff(user.companyId);
  }

  @Patch('staff/:userId')
  @RequirePermissions('payroll.manage')
  setSalary(
    @Param('userId') userId: string,
    @Body() dto: SetSalaryDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.payroll.setSalary(userId, dto, user.companyId);
  }

  // Рабочее время
  @Post('worktime')
  @RequirePermissions('payroll.manage')
  addWorkTime(
    @Body() dto: AddWorkTimeDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.payroll.addWorkTime({ ...dto, companyId: user.companyId });
  }

  // Авансы
  @Post('advances')
  @RequirePermissions('payroll.manage')
  addAdvance(
    @Body() dto: AddAdvanceDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.payroll.addAdvance({ ...dto, companyId: user.companyId });
  }

  // Периоды
  @Get('periods')
  @RequirePermissions('payroll.view')
  listPeriods(@CurrentUser() user: { sub: string; companyId: string }) {
    return this.payroll.listPeriods(user.companyId);
  }

  @Post('periods')
  @RequirePermissions('payroll.manage')
  createPeriod(
    @Body() dto: CreatePeriodDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.payroll.createPeriod({ ...dto, companyId: user.companyId });
  }

  @Post('periods/:id/close')
  @RequirePermissions('payroll.manage')
  closePeriod(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.payroll.closePeriod(id, user.companyId);
  }

  @Post('periods/:id/calculate')
  @RequirePermissions('payroll.manage')
  calculate(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.payroll.calculate(id, user.companyId);
  }

  @Get('periods/:id/records')
  @RequirePermissions('payroll.view')
  records(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.payroll.listRecords(id, user.companyId);
  }

  // Записи: бонус/удержание и выплата
  @Patch('records/:id')
  @RequirePermissions('payroll.manage')
  updateRecord(
    @Param('id') id: string,
    @Body() dto: UpdateRecordDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.payroll.updateRecord(id, dto, user.companyId);
  }

  @Post('records/:id/pay')
  @RequirePermissions('payroll.manage')
  pay(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.payroll.pay(id, user.companyId, user.sub);
  }
}
