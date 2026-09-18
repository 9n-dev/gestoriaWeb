import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { AppError, toUserMessage } from './errors';

describe('AppError', () => {
  it('keeps user and technical messages apart', () => {
    const error = new AppError(
      'NOT_FOUND',
      'No encontramos ese cliente.',
      'client 123 not in tenant A',
    );
    expect(error.userMessage).toBe('No encontramos ese cliente.');
    expect(error.message).toBe('client 123 not in tenant A');
    expect(error.status).toBe(404);
  });
});

describe('toUserMessage', () => {
  it('returns the user message of an AppError', () => {
    expect(toUserMessage(new AppError('FORBIDDEN', 'No tienes permiso.'))).toBe(
      'No tienes permiso.',
    );
  });

  it('never leaks Prisma or unknown error details', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint on users.email',
      {
        code: 'P2002',
        clientVersion: 'x',
      },
    );
    for (const error of [prismaError, new Error('ECONNREFUSED 10.0.0.1'), 'boom']) {
      const message = toUserMessage(error);
      expect(message).not.toMatch(/constraint|ECONNREFUSED|boom/);
      expect(message).toMatch(/error inesperado/i);
    }
  });
});
