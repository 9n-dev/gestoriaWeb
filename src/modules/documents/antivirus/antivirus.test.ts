import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { clamdScanner } from './clamd';
import { EICAR, fakeScanner } from './fake';

const text = (value: string) => new TextEncoder().encode(value);
const NUL = String.fromCharCode(0);

describe('fake scanner', () => {
  it('flags only the EICAR test file', async () => {
    expect(EICAR).toHaveLength(68);
    expect(await fakeScanner.scan(text('%PDF-1.7 factura'))).toEqual({ infected: false });
    expect(await fakeScanner.scan(text(`prefix ${EICAR}`))).toMatchObject({ infected: true });
  });
});

describe('clamd scanner', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  /** Minimal clamd: waits for the terminating zero-length chunk and answers with the given reply. */
  const stub = (reply: string) =>
    new Promise<{ port: number; received: () => Buffer }>((resolve) => {
      let received = Buffer.alloc(0);
      server = createServer((socket) => {
        socket.on('data', (data) => {
          received = Buffer.concat([received, data]);
          if (received.subarray(-4).equals(Buffer.alloc(4))) socket.end(reply);
        });
      }).listen(0, () =>
        resolve({ port: (server!.address() as { port: number }).port, received: () => received }),
      );
    });

  it('speaks INSTREAM and reports clean files', async () => {
    const { port, received } = await stub(`stream: OK${NUL}`);
    expect(await clamdScanner('127.0.0.1', port).scan(text('hola'))).toEqual({ infected: false });
    const sent = received();
    expect(sent.subarray(0, 10).toString()).toBe(`zINSTREAM${NUL}`);
    expect(sent.readUInt32BE(10)).toBe(4);
    expect(sent.subarray(14, 18).toString()).toBe('hola');
  });

  it('reports the signature of infected files', async () => {
    const { port } = await stub(`stream: Win.Test.EICAR_HDB-1 FOUND${NUL}`);
    expect(await clamdScanner('127.0.0.1', port).scan(text('x'))).toEqual({
      infected: true,
      signature: 'Win.Test.EICAR_HDB-1',
    });
  });

  it('never treats an error as clean', async () => {
    const { port } = await stub(`INSTREAM size limit exceeded. ERROR${NUL}`);
    await expect(clamdScanner('127.0.0.1', port).scan(text('x'))).rejects.toThrow(
      /unexpected clamd reply/,
    );
    await expect(clamdScanner('127.0.0.1', 1).scan(text('x'))).rejects.toThrow();
  });
});
