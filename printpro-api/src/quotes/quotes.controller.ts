import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { QuoteStatus } from '@prisma/client';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto, UpdateQuoteStatusDto } from './dto/quote.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('quotes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @RequirePermissions('orders.view')
  findAll(
    @CurrentUser() user: { sub: string; companyId: string },
    @Query('status') status?: QuoteStatus,
  ) {
    return this.quotes.findAll(user.companyId, status);
  }

  @Get(':id')
  @RequirePermissions('orders.view')
  findOne(
    @CurrentUser() user: { sub: string; companyId: string },
    @Param('id') id: string,
  ) {
    return this.quotes.findOne(id, user.companyId);
  }

  @Post()
  @RequirePermissions('orders.manage')
  create(
    @CurrentUser() user: { sub: string; companyId: string },
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotes.create({ ...dto, companyId: user.companyId });
  }

  @Patch(':id/status')
  @RequirePermissions('orders.manage')
  updateStatus(
    @CurrentUser() user: { sub: string; companyId: string },
    @Param('id') id: string,
    @Body() dto: UpdateQuoteStatusDto,
  ) {
    return this.quotes.updateStatus(id, user.companyId, dto.status);
  }

  // Превратить КП в заказ
  @Post(':id/convert')
  @RequirePermissions('orders.manage')
  convert(
    @CurrentUser() user: { sub: string; companyId: string },
    @Param('id') id: string,
  ) {
    return this.quotes.convert(id, user.companyId);
  }

  @Delete(':id')
  @RequirePermissions('orders.manage')
  remove(
    @CurrentUser() user: { sub: string; companyId: string },
    @Param('id') id: string,
  ) {
    return this.quotes.remove(id, user.companyId);
  }
}
