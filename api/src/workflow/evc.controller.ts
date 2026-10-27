import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth';
import { AuthUser } from '../common/types';
import { EvcService, ReportDto, ScheduleDto } from './evc.service';

@Controller()
export class EvcController {
  constructor(private readonly evc: EvcService) {}

  @Roles('officer', 'committee', 'regional', 'admin')
  @Get('evc/visits')
  list(@CurrentUser() u: AuthUser, @Query('region') region?: string, @Query('status') status?: string) {
    return this.evc.list(u, region, status);
  }

  @Roles('regional', 'admin')
  @Get('evc/members')
  members() {
    return this.evc.committeeMembers();
  }

  @Roles('regional', 'admin')
  @Post('applications/:id/evc/schedule')
  schedule(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.evc.schedule(u, id, ScheduleDto.parse(body));
  }

  @Roles('committee', 'regional', 'admin')
  @Post('applications/:id/evc/report')
  report(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.evc.report(u, id, ReportDto.parse(body));
  }
}
