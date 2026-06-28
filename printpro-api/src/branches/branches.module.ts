import { Module } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class CreateBranchDto {
  @IsString() companyId: string;
  @IsString() name: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
}

class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('branches')
@UseGuards(JwtAuthGuard)
class BranchesController {
  constructor(private readonly prisma: PrismaService) {}

  // По умолчанию — только активные (для выпадающих списков).
  // ?all=1 — включая отключённые (для управления в настройках).
  @Get()
  findAll(
    @Query('companyId') companyId: string,
    @Query('all') all?: string,
  ) {
    return this.prisma.branch.findMany({
      where: { companyId, ...(all === '1' ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  create(@Body() dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  // Мягкое отключение филиала (данные заказов/склада сохраняются).
  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.prisma.branch.update({
      where: { id },
      data: { isActive: false },
    });
  }
}

@Module({
  controllers: [BranchesController],
})
export class BranchesModule {}
