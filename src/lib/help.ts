import 'server-only';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { cache } from 'react';
import { titleOf } from './markdown';

const DIRECTORY = path.join(process.cwd(), 'content', 'help');

export type HelpArticle = { slug: string; title: string; source: string };

/** Help centre (§6.14): every `content/help/NN-slug.md`, in file-name order. */
export const listHelpArticles = cache(async (): Promise<HelpArticle[]> => {
  const files = (await readdir(DIRECTORY)).filter((file) => file.endsWith('.md')).sort();
  return Promise.all(
    files.map(async (file) => {
      const source = await readFile(path.join(DIRECTORY, file), 'utf8');
      return { slug: file.replace(/^\d+-|\.md$/g, ''), title: titleOf(source), source };
    }),
  );
});
