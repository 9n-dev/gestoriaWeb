import { connect } from 'node:net';
import type { ScanResult, VirusScanner } from './index';

const CHUNK = 64 * 1024;
const TIMEOUT_MS = 60_000;
const NUL = String.fromCharCode(0);

/**
 * clamd INSTREAM protocol: "zINSTREAM" + NUL, then <4-byte big-endian length><chunk>…, then a zero
 * length. Reply: "stream: OK" or "stream: <signature> FOUND". Anything else is an error, and an
 * error is never reported as clean: the job fails and is retried.
 */
export const clamdScanner = (host: string, port: number): VirusScanner => ({
  scan: (bytes) =>
    new Promise<ScanResult>((resolve, reject) => {
      const socket = connect({ host, port });
      let reply = '';
      socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('clamd timeout')));
      socket.on('error', reject);
      socket.on('data', (data) => (reply += data.toString()));
      socket.on('close', () => {
        const text = reply.replaceAll(NUL, '').trim();
        const found = /^stream: (.+) FOUND$/.exec(text);
        if (found) resolve({ infected: true, signature: found[1]! });
        else if (text === 'stream: OK') resolve({ infected: false });
        else reject(new Error(`unexpected clamd reply: "${text}"`));
      });
      socket.on('connect', () => {
        socket.write(`zINSTREAM${NUL}`);
        for (let offset = 0; offset < bytes.length; offset += CHUNK) {
          const chunk = bytes.subarray(offset, offset + CHUNK);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
    }),
});
