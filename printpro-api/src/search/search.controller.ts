import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

interface JwtUser {
  sub: string;
  companyId: string;
}

// companyId только из токена — поиск только по своей компании
@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@CurrentUser() user: JwtUser, @Query('q') q: string) {
    return this.search.search(user.companyId, q);
  }
}
