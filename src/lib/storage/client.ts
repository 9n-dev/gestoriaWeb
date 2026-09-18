import 'server-only';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '@/env';

const globalForS3 = globalThis as unknown as { s3?: S3Client };

/** S3-compatible client: MinIO in development, Cloudflare R2 in production. */
export function getStorage(): S3Client {
  return (globalForS3.s3 ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  }));
}

export async function pingStorage(): Promise<void> {
  await getStorage().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
}
