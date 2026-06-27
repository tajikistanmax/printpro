import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class CreateTaskDto {
  @IsString() companyId: string;
  @IsString() title: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientPhone?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsString() createdById?: string;
  @IsOptional() @IsString() dueDate?: string; // ISO дата
  @IsOptional() @IsInt() priority?: number; // 0 обычная, выше — важнее
}

export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus) status: TaskStatus;
}
