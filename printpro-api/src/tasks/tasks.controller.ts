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
import { TaskStatus } from '@prisma/client';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskStatusDto } from './dto/task.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('tasks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  // Поставить задачу
  @Post()
  @RequirePermissions('tasks.manage')
  create(
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.tasks.create({
      ...dto,
      companyId: user.companyId,
      createdById: user.sub,
    });
  }

  // Список задач (можно фильтровать по исполнителю и статусу)
  @Get()
  @RequirePermissions('tasks.view')
  findAll(
    @CurrentUser() user: { sub: string; companyId: string },
    @Query('assignedUserId') assignedUserId?: string,
    @Query('status') status?: TaskStatus,
  ) {
    return this.tasks.findAll(user.companyId, assignedUserId, status);
  }

  // Сотрудник отмечает выполнение (достаточно права просмотра своих задач)
  @Patch(':id/status')
  @RequirePermissions('tasks.view')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: { sub: string; companyId: string },
  ) {
    return this.tasks.updateStatus(id, dto.status, user.companyId);
  }
}
