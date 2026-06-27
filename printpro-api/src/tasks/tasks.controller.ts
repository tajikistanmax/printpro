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

@Controller('tasks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  // Поставить задачу
  @Post()
  @RequirePermissions('tasks.manage')
  create(@Body() dto: CreateTaskDto) {
    return this.tasks.create(dto);
  }

  // Список задач (можно фильтровать по исполнителю и статусу)
  @Get()
  @RequirePermissions('tasks.view')
  findAll(
    @Query('companyId') companyId: string,
    @Query('assignedUserId') assignedUserId?: string,
    @Query('status') status?: TaskStatus,
  ) {
    return this.tasks.findAll(companyId, assignedUserId, status);
  }

  // Сотрудник отмечает выполнение (достаточно права просмотра своих задач)
  @Patch(':id/status')
  @RequirePermissions('tasks.view')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTaskStatusDto) {
    return this.tasks.updateStatus(id, dto.status);
  }
}
