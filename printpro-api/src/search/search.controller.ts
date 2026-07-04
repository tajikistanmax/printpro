import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

interface JwtUser {
  sub: string;
  companyId: string;
}

// companyId только из токена — поиск только по своей компании.
// Глобальный поиск возвращает ПДн клиентов и заказы, поэтому требует прав
// просмотра клиентов/заказов (иначе низкопривилегированная роль перечисляла бы
// базу клиентов через /search в обход модульных прав).
@Controller('search')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequirePermissions('clients.view', 'orders.view')
  find(@CurrentUser() user: JwtUser, @Query('q') q: string) {
    return this.search.search(user.companyId, q);
  }
}
