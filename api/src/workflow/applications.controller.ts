import {
  BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth';
import { APPLICATION_TYPES, AuthUser, REQUIRED_DOCUMENTS, TYPE_LABELS } from '../common/types';
import { ApplicationsService, CreateDto } from './applications.service';

const ActDto = z.object({ action: z.string(), note: z.string().max(2000).optional() });

@Controller()
export class ApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  @Get('meta')
  meta() {
    return { types: APPLICATION_TYPES.map((t) => ({ type: t, label: TYPE_LABELS[t], requiredDocuments: REQUIRED_DOCUMENTS[t] })) };
  }

  @Get('applications')
  list(@CurrentUser() u: AuthUser, @Query('scope') scope?: string, @Query('state') state?: string) {
    return this.svc.list(u, scope === 'queue' ? 'queue' : scope === 'all' ? 'all' : 'mine', state);
  }

  @Post('applications')
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.svc.create(u, CreateDto.parse(body));
  }

  @Get('applications/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.get(u, id);
  }

  @Post('applications/:id/actions')
  async act(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const { action, note } = ActDto.parse(body);
    await this.svc.act(u, id, action, note);
    return this.svc.get(u, id);
  }

  @Post('applications/:id/documents')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  upload(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('docType') docType?: string,
  ) {
    if (!file || !docType) throw new BadRequestException('file and docType are required');
    return this.svc.uploadDocument(u, id, {
      docType, filename: file.originalname, contentType: file.mimetype || 'application/octet-stream', buffer: file.buffer,
    });
  }

  @Get('applications/:id/documents/:docId/file')
  async file(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('docId', ParseIntPipe) docId: number,
    @Res() res: Response,
  ) {
    const doc = await this.svc.download(u, id, docId);
    res.setHeader('Content-Type', doc.content_type);
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename.replace(/"/g, '')}"`);
    res.send(doc.buffer);
  }
}
