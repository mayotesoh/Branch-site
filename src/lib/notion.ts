import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { marked } from 'marked';

// DB ID は機密ではないためコードに保持。トークンだけ環境変数（.env / CI Secret）。
export const BLOG_DB = '04e8f32855ae4e80865ab3f2b92798cb';
export const INSTR_DB = '30e989297ce14ea99cbea84a2e5e2180';
export const COURSE_DB = '9e653e0af59e47ebb3c1c9d443339e48';

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

// ---- 講座 ----
export interface Course {
  pageId: string; // 申込フォームから講座を指定するのに使う
  name: string;
  type: string; // 養成講座 / セッション
  category: string;
  instructor: string;
  courseName: string;
  desc: string;
  period: string;
  method: string;
  afterCare: boolean;
  note: string;
  extra: string;
  order: number;
  curriculum: string[];
  /** オンライン申込の対象か */
  payable: boolean;
  /** 価格（円）。未設定は 0 */
  memberPrice: number;
  nonMemberPrice: number;
}

let _courses: Promise<Course[]> | null = null;

// 講師DB全件（公開/非公開問わず）から pageId → 氏名 のマップ
let _instrMap: Promise<Map<string, string>> | null = null;
function getInstructorMap(): Promise<Map<string, string>> {
  if (!_instrMap) {
    _instrMap = (async () => {
      const rows = await queryAll(INSTR_DB);
      const m = new Map<string, string>();
      for (const r of rows) m.set(r.id, pText(r.properties['名前']));
      return m;
    })();
  }
  return _instrMap;
}

export function getCourses(): Promise<Course[]> {
  if (!_courses) {
    _courses = (async () => {
      const instrMap = await getInstructorMap();
      const rows = await queryAll(COURSE_DB, {
        filter: { property: '公開', checkbox: { equals: true } },
        sorts: [{ property: '表示順', direction: 'ascending' }],
      });
      return Promise.all(
        rows.map(async (r) => {
          const p = r.properties;
          const type = pSelect(p['種別']);
          let curriculum: string[] = [];
          if (type === '養成講座') {
            const blocks: any = await notion.blocks.children.list({
              block_id: r.id,
              page_size: 100,
            });
            curriculum = blocks.results
              .filter((b: any) => b.type === 'bulleted_list_item')
              .map((b: any) =>
                b.bulleted_list_item.rich_text
                  .map((t: any) => t.plain_text)
                  .join('')
              );
          }
          return {
            pageId: r.id,
            name: pText(p['講座名']),
            type,
            category: pSelect(p['カテゴリ']),
            instructor: pRelIds(p['担当講師'])
              .map((id: string) => instrMap.get(id))
              .filter(Boolean)
              .join(' / '),
            courseName: pText(p['コース名']),
            desc: pText(p['説明']),
            period: pText(p['期間・時間']),
            method: pText(p['提供方法']),
            afterCare: pCheckbox(p['アフターフォロー']),
            note: pText(p['備考']),
            extra: pText(p['補足']),
            order: p['表示順']?.number ?? 0,
            curriculum,
            payable: pCheckbox(p['決済対象']),
            memberPrice: p['会員価格']?.number ?? 0,
            nonMemberPrice: p['非会員価格']?.number ?? 0,
          } as Course;
        })
      );
    })();
  }
  return _courses;
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
