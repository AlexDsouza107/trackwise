import { Body, Controller, Get, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuthUser, Role } from '../common/types';
import { DbService } from '../db/db.service';
import { CurrentUser, Public } from './auth';

const LoginDto = z.object({ email: z.string().email(), password: z.string().min(1) });

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  institution_id: number | null;
  region: string | null;
  password_hash: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly db: DbService, private readonly jwt: JwtService) {}

  @Public()
  @Post('login')
  async login(@Body() body: unknown) {
    const { email, password } = LoginDto.parse(body);
    const row = await this.db.one<UserRow>('select * from users where lower(email)=lower($1)', [email]);
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const user: AuthUser = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      institutionId: row.institution_id,
      region: row.region,
    };
    return { token: await this.jwt.signAsync(user), user };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  /** Public list of demo accounts so the login page can offer one-click sign-in. */
  @Public()
  @Get('demo-accounts')
  async demoAccounts() {
    return this.db.query(
      `select u.email, u.name, u.role, u.region, i.name as institution
         from users u left join institutions i on i.id = u.institution_id
        order by array_position(array['admin','officer','regional','committee','institution'], u.role), u.id`,
    );
  }
}
