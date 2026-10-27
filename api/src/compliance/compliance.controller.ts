import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { assertRegionAccess, effectiveRegion } from '../common/access';
import { AuthUser } from '../common/types';
import { CurrentUser, Roles } from '../auth/auth';
import { ComplianceService, RulePatchDto } from './compliance.service';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly svc: ComplianceService) {}

  @Roles('officer', 'committee', 'regional', 'admin')
  @Get('overview')
  overview(@CurrentUser() u: AuthUser, @Query('region') region?: string) {
    return this.svc.overview(effectiveRegion(u, region));
  }

  @Get('rules')
  rules() {
    return this.svc.rules();
  }

  @Get('institutions/:id')
  async detail(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    if (u.role === 'institution' && u.institutionId !== id) throw new ForbiddenException();
    const d = await this.svc.detail(id);
    assertRegionAccess(u, (d.institution as { region: string | null }).region);
    return d;
  }

  @Roles('admin')
  @Post('rules/:code')
  updateRule(@Param('code') code: string, @Body() body: unknown) {
    return this.svc.updateRule(code, RulePatchDto.parse(body));
  }

  @Roles('admin')
  @Post('evaluate-all')
  async evaluateAll() {
    return { evaluated: await this.svc.evaluateAllActive() };
  }

  @Roles('officer', 'regional', 'admin')
  @Post('institutions/:id/evaluate')
  evaluate(@Param('id', ParseIntPipe) id: number) {
    return this.svc.evaluateInstitution(id);
  }
}
