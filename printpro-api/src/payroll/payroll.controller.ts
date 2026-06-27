import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
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

@Controller('payroll')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  // Ставки сотрудников
  @Get('staff')
  @RequirePermissions('payroll.view')
  staff(@Query('companyId') companyId: string) {
    return this.payroll.staff(companyId);
  }

  @Patch('staff/:userId')
  @RequirePermissions('payroll.manage')
  setSalary(@Param('userId') userId: string, @Body() dto: SetSalaryDto) {
    return this.payroll.setSalary(userId, dto);
  }

  // Рабочее время
  @Post('worktime')
  @RequirePermissions('payroll.manage')
  addWorkTime(@Body() dto: AddWorkTimeDto) {
    return this.payroll.addWorkTime(dto);
  }

  // Авансы
  @Post('advances')
  @RequirePermissions('payroll.manage')
  addAdvance(@Body() dto: AddAdvanceDto) {
    return this.payroll.addAdvance(dto);
  }

  // Периоды
  @Get('periods')
  @RequirePermissions('payroll.view')
  listPeriods(@Query('companyId') companyId: string) {
    return this.payroll.listPeriods(companyId);
  }

  @Post('periods')
  @RequirePermissions('payroll.manage')
  createPeriod(@Body() dto: CreatePeriodDto) {
    return this.payroll.createPeriod(dto);
  }

  @Post('periods/:id/close')
  @RequirePermissions('payroll.manage')
  closePeriod(@Param('id') id: string) {
    return this.payroll.closePeriod(id);
  }

  @Post('periods/:id/calculate')
  @RequirePermissions('payroll.manage')
  calculate(@Param('id') id: string) {
    return this.payroll.calculate(id);
  }

  @Get('periods/:id/records')
  @RequirePermissions('payroll.view')
  records(@Param('id') id: string) {
    return this.payroll.listRecords(id);
  }

  // Записи: бонус/удержание и выплата
  @Patch('records/:id')
  @RequirePermissions('payroll.manage')
  updateRecord(@Param('id') id: string, @Body() dto: UpdateRecordDto) {
    return this.payroll.updateRecord(id, dto);
  }

  @Post('records/:id/pay')
  @RequirePermissions('payroll.manage')
  pay(@Param('id') id: string) {
    return this.payroll.pay(id);
  }
}
