import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableCors({ origin: true });
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`TrackWise API listening on :${config.port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
