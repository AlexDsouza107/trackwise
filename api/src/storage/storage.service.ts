import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { config } from '../config';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger('Storage');
  private readonly s3 = new S3Client({
    endpoint: config.minio.endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: config.minio.accessKey, secretAccessKey: config.minio.secretKey },
  });

  async onModuleInit(): Promise<void> {
    const Bucket = config.minio.bucket;
    for (let attempt = 1; ; attempt++) {
      try {
        try {
          await this.s3.send(new HeadBucketCommand({ Bucket }));
        } catch {
          await this.s3.send(new CreateBucketCommand({ Bucket }));
        }
        this.log.log(`Bucket "${Bucket}" ready`);
        return;
      } catch (err) {
        if (attempt >= 30) throw err;
        this.log.warn(`MinIO not ready (attempt ${attempt}), retrying...`);
        await sleep(2000);
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: config.minio.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: config.minio.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
}
