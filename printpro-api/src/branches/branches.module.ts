import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PrismaService } from '../prisma/prisma.service';

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

interface JwtUser {
  sub: string;
  companyId: string;
}

@Controller('branches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
class BranchesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll(@CurrentUser() user: JwtUser, @Query('all') all?: string) {
    return this.prisma.branch.findMany({
      where: {
        companyId: user.companyId,
        deletedAt: null,
        ...(all === '1' ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() dto: CreateBranchDto, @CurrentUser() user: JwtUser) {
    return this.prisma.branch.create({
      data: { ...dto, companyId: user.companyId },
    });
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser() user: JwtUser,
  ) {
    const res = await this.prisma.branch.updateMany({
      where: { id, companyId: user.companyId, deletedAt: null },
      data: dto,
    });
    if (res.count === 0) throw new NotFoundException('Branch not found');
    return this.prisma.branch.findUnique({ where: { id } });
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  async deactivate(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const res = await this.prisma.branch.updateMany({
      where: { id, companyId: user.companyId, deletedAt: null },
      data: { isActive: false },
    });
    if (res.count === 0) throw new NotFoundException('Branch not found');
    return { ok: true };
  }
}

@Module({
  controllers: [BranchesController],
})
export class BranchesModule {}
