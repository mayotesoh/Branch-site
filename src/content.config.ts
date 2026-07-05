import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// ブログ記事コレクション（現状: ローカルMarkdown）
// Notion連携時は loader を Notion用ローダーに差し替えるだけで、
// ページ側（一覧・記事・著者別）はそのまま使える設計。
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    /** src/data/authors.ts の著者ID */
    author: z.string(),
    publishDate: z.coerce.date(),
    excerpt: z.string().optional(),
    /** public/ 配下のカバー画像ファイル名（任意） */
    cover: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
