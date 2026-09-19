import Link from 'next/link';
import { listHelpArticles } from '@/lib/help';

export default async function HelpIndexPage() {
  const articles = await listHelpArticles();
  return (
    <>
      <h1 className="text-2xl font-semibold">Ayuda</h1>
      <ul className="flex flex-col divide-y divide-border">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={`/ayuda/${article.slug}`}
              className="block py-3 underline-offset-4 hover:underline"
            >
              {article.title}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
