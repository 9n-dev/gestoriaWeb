import type { VirusScanner } from './index';

// Standard antivirus test file: harmless, and detected by every real engine too. Assembled from
// two halves so that this source file is not itself quarantined by a desktop antivirus.
export const EICAR = [
  'X5O!P%@AP[4',
  'PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
].join(String.fromCharCode(92));

/** Development and test scanner: everything is clean except the EICAR test file. */
export const fakeScanner: VirusScanner = {
  async scan(bytes) {
    return Buffer.from(bytes).includes(EICAR)
      ? { infected: true, signature: 'Eicar-Test-Signature (fake scanner)' }
      : { infected: false };
  },
};
