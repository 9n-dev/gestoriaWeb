import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listHelpArticles } from '@/lib/help';
import { Markdown } from '@/lib/markdown';

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = (await listHelpArticles()).find((item) => item.slug === slug);
  if (!article) notFound();
  return (
    <>
      <p className="text-sm">
        <Link href="/ayuda" className="underline">
          Todos los artículos
        </Link>
      </p>
      <article className="flex max-w-prose flex-col gap-3">
        <Markdown source={article.source} />
      </article>
    </>
  );
}
