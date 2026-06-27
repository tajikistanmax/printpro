import { IsString } from 'class-validator';

// Единица измерения: штука (шт), рулон (рул), метр квадратный (м²)
export class CreateUnitDto {
  @IsString() companyId: string;
  @IsString() name: string;
  @IsString() shortName: string;
}
