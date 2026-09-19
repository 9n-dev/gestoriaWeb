import { env } from '@/env';
import { anthropicExtractor } from './anthropic';
import { fakeExtractor } from './fake';
import type { DocumentExtractor } from './types';

export const getDocumentExtractor = (): DocumentExtractor =>
  env.ANTHROPIC_API_KEY ? anthropicExtractor(env.ANTHROPIC_MODEL) : fakeExtractor;
