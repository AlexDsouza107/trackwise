import 'reflect-metadata';
import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ZodError } from 'zod';
import { AppModule } from './app.module';
import { config } from './config';

@Catch(ZodError)
class ZodFilter implements ExceptionFilter {
  catch(err: ZodError, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(400).json({
      statusCode: 400,
      message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableCors({ origin: true });
  app.useGlobalFilters(new ZodFilter());
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`TrackWise API listening on :${config.port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
