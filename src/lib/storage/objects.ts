import 'server-only';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@/env';
import { getStorage } from './client';

/** Small server-side uploads (logos, generated PDFs). Client uploads use multipart (phase 3). */
export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await getStorage().send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const { Body } = await getStorage().send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
  if (!Body) throw new Error(`empty object ${key}`);
  return Body.transformToByteArray();
}
