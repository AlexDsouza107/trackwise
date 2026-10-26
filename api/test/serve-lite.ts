/**
 * Runs the real API with in-memory stand-ins for MinIO and Redis/BullMQ (no Docker needed).
 * Documents vanish on restart and alert scans are not scheduled; use the "Run alert scan" button.
 * For development and demos only. `docker compose up` runs the real stack.
 */
import 'reflect-metadata';
import { AppModule } from '../src/app.module';
import { QueueService } from '../src/alerts/queue.service';
import { config } from '../src/config';
import { StorageService } from '../src/storage/storage.service';

const files = new Map<string, Buffer>();

async function main() {
  const { Test } = await import('@nestjs/testing');
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService).useValue({
      onModuleInit: async () => undefined,
      put: async (k: string, b: Buffer) => void files.set(k, b),
      get: async (k: string) => files.get(k)!,
      delete: async (k: string) => void files.delete(k),
    })
    .overrideProvider(QueueService).useValue({
      email: { add: async () => undefined }, scan: {}, setScanHandler: () => undefined,
      onModuleInit: async () => undefined, onModuleDestroy: async () => undefined,
    })
    .compile();
  const app = mod.createNestApplication();
  app.enableCors({ origin: true });
  await app.listen(config.port, '0.0.0.0');
  console.log(`TrackWise API (lite, in-memory storage/queues) on :${config.port}`);
}
void main();
