import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { marked } from 'marked';

// DB ID は機密ではないためコードに保持。トークンだけ環境変数（.env / CI Secret）。
export const BLOG_DB = '04e8f32855ae4e80865ab3f2b92798cb';
export const INSTR_DB = '30e989297ce14ea99cbea84a2e5e2180';

const token =
  (import.meta.env as any).NOTION_TOKEN ?? process.env.NOTION_TOKEN;

if (!token) {
  throw new Error(
    'NOTION_TOKEN が未設定です。ローカルは .env に、CI は GitHub Secrets に設定してください。'
  );
}

const notion = new Client({ auth: token });
const n2m = new NotionToMarkdown({ notionClient: notion });

// ---- プロパティ取り出しヘルパー ----
const pText = (p: any) =>
  (p?.title ?? p?.rich_text ?? []).map((t: any) => t.plain_text).join('');
const pSelect = (p: any) => p?.select?.name ?? '';
const pMulti = (p: any) => (p?.multi_select ?? []).map((o: any) => o.name);
const pDate = (p: any) => p?.date?.start ?? '';
const pCheckbox = (p: any) => !!p?.checkbox;
const pFile = (p: any) => {
  const f = (p?.files ?? [])[0];
  return f ? f.external?.url ?? f.file?.url ?? '' : '';
};
const pRelIds = (p: any) => (p?.relation ?? []).map((r: any) => r.id);

// ---- 型 ----
export interface Author {
  pageId: string;
  id: string;
  name: string;
  kana: string;
  role: string;
  image: string;
}
export interface PostMeta {
  slug: string;
  title: string;
  authorId: string;
  authorName: string;
  authorImage: string;
  publishDate: Date;
  excerpt: string;
  cover: string;
  tags: string[];
}

// ---- ページ全件取得（ページネーション対応） ----
async function queryAll(database_id: string, extra: any = {}) {
  const out: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const res: any = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size: 100,
      ...extra,
    });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

// ---- キャッシュ（ビルド中の重複取得を防ぐ） ----
let _authors: Promise<Author[]> | null = null;
let _posts: Promise<PostMeta[]> | null = null;

export function getAuthors(): Promise<Author[]> {
  if (!_authors) {
    _authors = (async () => {
      const rows = await queryAll(INSTR_DB, {
        filter: { property: '公開', checkbox: { equals: true } },
      });
      return rows.map((r) => {
        const p = r.properties;
        return {
          pageId: r.id,
          id: pText(p['id']),
          name: pText(p['名前']),
          kana: pText(p['よみ']),
          role: pText(p['肩書き']),
          image: pFile(p['顔写真']),
        } as Author;
      });
    })();
  }
  return _authors;
}

export function getPosts(): Promise<PostMeta[]> {
  if (!_posts) {
    _posts = (async () => {
      const authors = await getAuthors();
      const byPage = new Map(authors.map((a) => [a.pageId, a]));
      const rows = await queryAll(BLOG_DB, {
        filter: { property: '公開状態', select: { equals: '公開' } },
        sorts: [{ property: '公開日', direction: 'descending' }],
      });
      return rows.map((r) => {
        const p = r.properties;
        const authorPage = pRelIds(p['著者'])[0];
        const author = authorPage ? byPage.get(authorPage) : undefined;
        const slug = pText(p['slug']) || r.id.replace(/-/g, '');
        return {
          slug,
          title: pText(p['タイトル']),
          authorId: author?.id ?? '',
          authorName: author?.name ?? '',
          authorImage: author?.image ?? '',
          publishDate: new Date(pDate(p['公開日']) || r.created_time),
          excerpt: pText(p['抜粋']),
          cover: pFile(p['カバー画像']),
          tags: pMulti(p['タグ']),
          _pageId: r.id,
        } as PostMeta & { _pageId: string };
      });
    })();
  }
  return _posts;
}

// ---- 記事本文（Markdown → HTML） ----
export async function getPostHtml(slug: string): Promise<string> {
  const posts = (await getPosts()) as (PostMeta & { _pageId: string })[];
  const post = posts.find((p) => p.slug === slug);
  if (!post) return '';
  const mdblocks = await n2m.pageToMarkdown(post._pageId);
  const md = n2m.toMarkdownString(mdblocks).parent ?? '';
  return await marked.parse(md);
}
