import { env } from '@/env';
import { clamdScanner } from './clamd';
import { fakeScanner } from './fake';

export type ScanResult = { infected: false } | { infected: true; signature: string };

export interface VirusScanner {
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

/** clamd when CLAMAV_HOST is set; otherwise the development fake (flags only the EICAR test file). */
export const getVirusScanner = (): VirusScanner =>
  env.CLAMAV_HOST ? clamdScanner(env.CLAMAV_HOST, env.CLAMAV_PORT) : fakeScanner;
