import { Module } from '@nestjs/common';
import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { IsString, IsOptional } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class CreateBranchDto {
  @IsString() companyId: string;
  @IsString() name: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
}

@Controller('branches')
@UseGuards(JwtAuthGuard)
class BranchesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll(@Query('companyId') companyId: string) {
    return this.prisma.branch.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  create(@Body() dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }
}

@Module({
  controllers: [BranchesController],
})
export class BranchesModule {}
