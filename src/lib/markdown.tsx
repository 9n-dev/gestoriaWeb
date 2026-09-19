import type { ReactNode } from 'react';

/**
 * The slice of Markdown the help articles use: #/## headings, paragraphs, "-" and "1." lists,
 * **bold** and [links](url). Builds React nodes, so article text can never inject HTML.
 * ponytail: no nesting, tables, images or code blocks; add a real parser if articles outgrow this.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g).map((part, index) => {
    if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    // Only site-relative and https links: an article must not smuggle a javascript: URL.
    if (link && /^(\/|https:\/\/)/.test(link[2]!)) {
      return (
        <a key={index} href={link[2]} className="underline">
          {link[1]}
        </a>
      );
    }
    return part;
  });
}

export function titleOf(markdown: string): string {
  return /^# (.+)$/m.exec(markdown)?.[1]?.trim() ?? 'Sin título';
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split('\n').map((line) => line.trim());
        if (block.startsWith('# ')) {
          return (
            <h1 key={index} className="text-2xl font-semibold">
              {inline(block.slice(2))}
            </h1>
          );
        }
        if (block.startsWith('## ')) {
          return (
            <h2 key={index} className="mt-2 text-lg font-semibold">
              {inline(block.slice(3))}
            </h2>
          );
        }
        if (lines.every((line) => line.startsWith('- '))) {
          return (
            <ul key={index} className="flex list-disc flex-col gap-1 pl-5">
              {lines.map((line, i) => (
                <li key={i}>{inline(line.slice(2))}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((line) => /^\d+\. /.test(line))) {
          return (
            <ol key={index} className="flex list-decimal flex-col gap-1 pl-5">
              {lines.map((line, i) => (
                <li key={i}>{inline(line.replace(/^\d+\. /, ''))}</li>
              ))}
            </ol>
          );
        }
        return <p key={index}>{inline(lines.join(' '))}</p>;
      })}
    </>
  );
}
