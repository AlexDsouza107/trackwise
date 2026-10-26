import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth';
import { DbService } from './db/db.service';

@Controller()
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get('health')
  async health() {
    const row = await this.db.one<{ n: string }>('select count(*) n from applications');
    return { status: 'ok', applications: Number(row!.n) };
  }
}
