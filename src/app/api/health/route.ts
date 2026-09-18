import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runHealthChecks } from '@/lib/health';
import { pingRedis } from '@/lib/redis';
import { pingStorage } from '@/lib/storage/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await runHealthChecks({
    db: () => prisma.$queryRaw`SELECT 1`,
    redis: pingRedis,
    storage: pingStorage,
  });
  return NextResponse.json(report, { status: report.status === 'ok' ? 200 : 503 });
}
