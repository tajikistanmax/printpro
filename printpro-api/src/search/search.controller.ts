import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SearchService } from './search.service';

interface JwtUser {
  sub: string;
  companyId: string;
  roleId: string;
}

@Controller('search')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  // Входной барьер — глобальным поиском пользуются те, кто работает с заказами.
  // Внутри сервис дополнительно фильтрует выдачу по правам роли на каждую сущность.
  @RequirePermissions('orders.view')
  find(@CurrentUser() user: JwtUser, @Query('q') q: string) {
    // companyId и roleId — только из JWT, никогда из query
    return this.search.search(user.companyId, user.roleId, q);
  }
}
