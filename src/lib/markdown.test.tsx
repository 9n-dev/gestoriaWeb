import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, titleOf } from './markdown';

const html = (source: string) => renderToStaticMarkup(<Markdown source={source} />);

describe('markdown', () => {
  it('renders headings, paragraphs, lists, bold and links', () => {
    const out = html(
      '# Título\n\nUn **párrafo**\nen dos líneas.\n\n- uno\n- [dos](/subir)\n\n1. a\n2. b',
    );
    expect(out).toContain('<h1');
    expect(out).toContain('<strong>párrafo</strong> en dos líneas.');
    expect(out).toMatch(/<ul[^>]*><li>uno<\/li><li><a href="\/subir"/);
    expect(out).toMatch(/<ol[^>]*><li>a<\/li><li>b<\/li><\/ol>/);
  });

  it('never emits raw HTML nor dangerous links', () => {
    const out = html('<script>alert(1)</script> [x](javascript:alert(1))');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('href="javascript');
  });

  it('finds the title', () => {
    expect(titleOf('# Subir documentos\n\nTexto')).toBe('Subir documentos');
  });
});
