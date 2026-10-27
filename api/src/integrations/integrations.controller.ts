import { Controller, ForbiddenException, Get, Param, ParseIntPipe } from '@nestjs/common';
import { assertRegionAccess } from '../common/access';
import { CurrentUser } from '../auth/auth';
import { AuthUser } from '../common/types';
import { DbService } from '../db/db.service';
import { DIGILOCKER_TYPES, IntegrationsService } from './integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService, private readonly db: DbService) {}

  @Get()
  list() {
    return { adapters: this.svc.list(), digilockerTypes: Object.keys(DIGILOCKER_TYPES) };
  }

  @Get('accreditation/:institutionId')
  async accreditation(@CurrentUser() u: AuthUser, @Param('institutionId', ParseIntPipe) id: number) {
    if (u.role === 'institution' && u.institutionId !== id) throw new ForbiddenException();
    const r = await this.svc.accreditation(id);
    const inst = await this.db.one<{ region: string | null }>('select region from institutions where id=$1', [id]);
    assertRegionAccess(u, inst?.region ?? null);
    return r;
  }
}
