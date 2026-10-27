import {
  BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/auth';
import { AuthUser } from '../common/types';
import { AddFields, EXPIRING_SOON_DAYS, RenewFields, VALIDITY_KINDS, ValidityService, VerifyDto } from './validity.service';

const upload = () => FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

@Controller('validity')
export class ValidityController {
  constructor(private readonly svc: ValidityService) {}

  @Get('kinds')
  kinds() {
    return { kinds: Object.entries(VALIDITY_KINDS).map(([kind, label]) => ({ kind, label })), expiringSoonDays: EXPIRING_SOON_DAYS };
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('region') region?: string, @Query('institutionId') inst?: string) {
    return this.svc.list(u, { status, region, institutionId: inst ? Number(inst) : undefined });
  }

  @Post()
  @UseInterceptors(upload())
  add(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    if (!file) throw new BadRequestException('A file is required');
    return this.svc.add(u, AddFields.parse(body), file);
  }

  @Post(':id/renew')
  @UseInterceptors(upload())
  renew(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    if (!file) throw new BadRequestException('The renewed document file is required');
    return this.svc.renew(u, id, RenewFields.parse(body), file);
  }

  @Post(':id/verify')
  verify(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.svc.verify(u, id, VerifyDto.parse(body));
  }

  @Get(':id/file')
  async file(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Query('which') which: string | undefined, @Res() res: Response) {
    const f = await this.svc.file(u, id, which === 'renewal' ? 'renewal' : 'current');
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${f.filename.replace(/"/g, '')}"`);
    res.send(f.buffer);
  }
}
