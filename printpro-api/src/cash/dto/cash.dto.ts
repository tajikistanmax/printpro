import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Открыть смену кассы
export class OpenShiftDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsNumber() @Min(0) openingBalance?: number;
}

// Закрыть смену кассы
export class CloseShiftDto {
  // Фактически пересчитанные деньги в кассе (если не указано — берём расчётный остаток)
  @IsOptional() @IsNumber() @Min(0) countedBalance?: number;
}

// Внести / изъять деньги из кассы (не связано с заказом)
export class CashMovementDto {
  @IsEnum({ IN: 'IN', OUT: 'OUT' } as const, {
    message: 'type должен быть IN (внесение) или OUT (изъятие)',
  })
  type: 'IN' | 'OUT';

  @IsNumber() @Min(0.01) amount: number;
  @IsOptional() @IsString() reason?: string;
  // Если не передан — применяем к текущей открытой смене пользователя
  @IsOptional() @IsString() shiftId?: string;
}
