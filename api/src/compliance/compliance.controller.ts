import { Controller, ForbiddenException, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AuthUser } from '../common/types';
import { CurrentUser, Roles } from '../auth/auth';
import { ComplianceService } from './compliance.service';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly svc: ComplianceService) {}

  @Roles('officer', 'committee', 'admin')
  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  @Get('rules')
  rules() {
    return this.svc.rules();
  }

  @Get('institutions/:id')
  detail(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    if (u.role === 'institution' && u.institutionId !== id) throw new ForbiddenException();
    return this.svc.detail(id);
  }

  @Roles('officer', 'admin')
  @Post('institutions/:id/evaluate')
  evaluate(@Param('id', ParseIntPipe) id: number) {
    return this.svc.evaluateInstitution(id);
  }
}
