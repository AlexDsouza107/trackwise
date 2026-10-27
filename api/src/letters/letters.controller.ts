import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth';
import { AuthUser } from '../common/types';
import { LettersService } from './letters.service';

const pdf = (res: Response, name: string, body: Buffer) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name}"`);
  res.send(body);
};

@Controller('applications/:id')
export class LettersController {
  constructor(private readonly svc: LettersService) {}

  @Get('draft-deficiency')
  draft(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.draftDeficiencyNote(u, id);
  }

  @Get('deficiency-letter')
  letter(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.deficiencyLetter(u, id);
  }

  @Get('deficiency-letter.pdf')
  async letterPdf(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    pdf(res, `deficiency-letter-${id}.pdf`, await this.svc.deficiencyLetterPdf(u, id));
  }

  @Get('case-summary')
  summary(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.caseSummary(u, id);
  }

  @Get('case-summary.pdf')
  async summaryPdf(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    pdf(res, `case-summary-${id}.pdf`, await this.svc.caseSummaryPdf(u, id));
  }
}
