import { describe, expect, it } from 'vitest';
import { sniffDocumentType } from './sniff';

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );

describe('sniffDocumentType', () => {
  it('recognises the accepted formats from their bytes', () => {
    expect(sniffDocumentType(bytes([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniffDocumentType(bytes([0x89], 'PNG', [0x0d, 0x0a]))?.mime).toBe('image/png');
    expect(sniffDocumentType(bytes('%PDF-1.7'))?.mime).toBe('application/pdf');
    expect(sniffDocumentType(bytes([0x0a, 0x0a], '%PDF-1.4'))?.mime).toBe('application/pdf');
    expect(sniffDocumentType(bytes([0, 0, 0, 0x18], 'ftypheic'))?.mime).toBe('image/heic');
    expect(sniffDocumentType(bytes([0, 0, 0, 0x18], 'ftypmif1'))?.mime).toBe('image/heic');
  });

  it('rejects everything else, whatever it claims to be', () => {
    expect(sniffDocumentType(bytes('MZ executable'))).toBeNull();
    expect(sniffDocumentType(bytes('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffDocumentType(bytes('PK', [3, 4], ' zip or docx'))).toBeNull();
    expect(sniffDocumentType(bytes([0, 0, 0, 0x18], 'ftypisom'))).toBeNull(); // mp4 video
    expect(sniffDocumentType(new Uint8Array())).toBeNull();
  });
});
