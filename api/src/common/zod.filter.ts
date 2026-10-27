import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';

/** Turns zod validation failures into a 400 with a readable message instead of a 500. */
@Catch(ZodError)
export class ZodFilter implements ExceptionFilter {
  catch(err: ZodError, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(400).json({
      statusCode: 400,
      message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }
}
