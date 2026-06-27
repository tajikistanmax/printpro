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

@Controller('quotes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @RequirePermissions('orders.view')
  findAll(
    @Query('companyId') companyId: string,
    @Query('status') status?: QuoteStatus,
  ) {
    return this.quotes.findAll(companyId, status);
  }

  @Get(':id')
  @RequirePermissions('orders.view')
  findOne(@Param('id') id: string) {
    return this.quotes.findOne(id);
  }

  @Post()
  @RequirePermissions('orders.manage')
  create(@Body() dto: CreateQuoteDto) {
    return this.quotes.create(dto);
  }

  @Patch(':id/status')
  @RequirePermissions('orders.manage')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateQuoteStatusDto) {
    return this.quotes.updateStatus(id, dto.status);
  }

  // Превратить КП в заказ
  @Post(':id/convert')
  @RequirePermissions('orders.manage')
  convert(@Param('id') id: string) {
    return this.quotes.convert(id);
  }

  @Delete(':id')
  @RequirePermissions('orders.manage')
  remove(@Param('id') id: string) {
    return this.quotes.remove(id);
  }
}
