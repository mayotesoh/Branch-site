import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { marked } from 'marked';
import imageMap from '../data/notion-images.json';

/**
 * Notionにアップされた画像のURL（S3署名付き）は約1時間で期限切れになるため、
 * ビルド前に取り込んだローカル画像（/notion/xxx.jpg）へ差し替えます。
 * 対応表は tools/fetch-notion-images.mjs が生成します。
 */
export function localizeImage(url: string): string {
  if (!url) return url;
  const key = url.split('?')[0];
  return (imageMap as Record<string, string>)[key] ?? url;
}

// 本文HTML内に埋め込まれたNotionのS3 URLをローカル画像へ差し替える
const NOTION_URL_RE =
  /https?:\/\/[^\s"')]*(?:prod-files-secure|secure\.notion-static\.com|s3\.[^\s"')]*amazonaws\.com)[^\s"')]*/g;
export function localizeHtml(html: string): string {
  if (!html) return html;
  return html.replace(NOTION_URL_RE, (m) => localizeImage(m));
}

// DB ID は機密ではないためコードに保持。トークンだけ環境変数（.env / CI Secret）。
export const BLOG_DB = '04e8f32855ae4e80865ab3f2b92798cb';
export const INSTR_DB = '30e989297ce14ea99cbea84a2e5e2180';
export const COURSE_DB = '9e653e0af59e47ebb3c1c9d443339e48';
export const INSTA_DB = '3a776a170aae818e8b00ea3294ee042f';
export const VOICE_DB = '3a776a170aae81e88abbd889d401e589';
export const EVENT_DB = '3a776a170aae814d8066e4c4161e9961';
export const THEME_DB = '3d276a170aae81c2a286d911351cf3dc';
export const THEME_ANSWER_DB = '3d276a170aae81c28f3acf6a1b4f0eb8';
export const QUIZ_DB = '3d276a170aae819fb797f0aad61dfac1';
export const MEMBER_DB = 'ca1b82cb-70c3-4995-b15b-362181c387cd';

let _memberArtOptions: Promise<string[]> | null = null;
/** 会員DB「占術」マルチセレクトの選択肢（会員ページの自己設定用） */
export function getMemberArtOptions(): Promise<string[]> {
  if (!_memberArtOptions) {
    _memberArtOptions = (async () => {
      try {
        const db: any = await notion.databases.retrieve({ database_id: MEMBER_DB });
        return (db.properties?.['占術']?.multi_select?.options ?? []).map((o: any) => o.name);
      } catch {
        return [];
      }
    })();
  }
  return _memberArtOptions;
}

const token =
  (import.meta.env as any).NOTION_TOKEN ?? process.env.NOTION_TOKEN;

if (!token) {
  throw new Error(
    'NOTION_TOKEN が未設定です。ローカルは .env に、CI は GitHub Secrets に設定してください。'
  );
}

// Notion APIのレート制限(429)・一時エラー(5xx)を指数バックオフで自動リトライする fetch。
// ビルドで多数のNotion呼び出しをするため、これが無いとCIで rate_limited により失敗しうる。
const retryingFetch = async (url: any, init?: any): Promise<any> => {
  const MAX = 6;
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if ((res.status === 429 || res.status === 502 || res.status === 503) && i < MAX) {
      const ra = Number(res.headers.get('retry-after'));
      const waitSec = ra > 0 ? ra : Math.min(2 ** i, 10);
      await new Promise((r) => setTimeout(r, waitSec * 1000 + Math.random() * 400));
      continue;
    }
    return res;
  }
};

const notion = new Client({ auth: token, fetch: retryingFetch as any });
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
// files プロパティ → { src, caption }[]（ギャラリー用）。
// caption はファイル名。IMG_1234 等のカメラ既定名は空にする（＝キャプション非表示）。
const pGallery = (p: any) =>
  (p?.files ?? [])
    .map((f: any) => {
      const url = f.external?.url ?? f.file?.url ?? '';
      const raw = String(f.name ?? '').replace(/\.[a-z0-9]+$/i, '').trim();
      const junky =
        /^(img|dsc|image|photo|mvimg|pxl|screenshot|line_album)[ _-]?.*$/i.test(raw) ||
        /^[0-9a-f]{8,}$/i.test(raw) ||
        /^\d[\d_.-]*$/.test(raw);
      return { src: localizeImage(url), caption: junky ? '' : raw };
    })
    .filter((g: any) => g.src);
const pRelIds = (p: any) => (p?.relation ?? []).map((r: any) => r.id);

// ---- 型 ----
export interface Author {
  pageId: string;
  id: string;
  name: string;
  kana: string;
  role: string;
  image: string;
  arts: string[];
  gallery: { src: string; caption: string }[];
  sns: {
    instagram: string;
    facebook: string;
    x: string;
    threads: string;
    tiktok: string;
    youtube: string;
    hp: string;
  };
}

// URL に http(s) が無い場合は https:// を補う
const withProto = (u?: string) =>
  u ? (/^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/+/, '')) : '';
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
        sorts: [{ property: '表示順', direction: 'ascending' }],
      });
      return rows.map((r) => {
        const p = r.properties;
        return {
          pageId: r.id,
          id: pText(p['id']),
          name: pText(p['名前']),
          kana: pText(p['よみ']),
          role: pText(p['肩書き']),
          image: localizeImage(pFile(p['顔写真'])),
          arts: pMulti(p['占術']),
          gallery: pGallery(p['ギャラリー']),
          sns: {
            instagram: withProto(p['Instagram']?.url),
            facebook: withProto(p['Facebook']?.url),
            x: withProto(p['X']?.url),
            threads: withProto(p['Threads']?.url),
            tiktok: withProto(p['TikTok']?.url),
            youtube: withProto(p['YouTube']?.url),
            hp: withProto(p['HP']?.url),
          },
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
      const now = Date.now();
      return rows
        .map((r) => {
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
            cover: localizeImage(pFile(p['カバー画像'])),
            tags: pMulti(p['タグ']),
            _pageId: r.id,
          } as PostMeta & { _pageId: string };
        })
        // 予約投稿：公開日が未来の記事は、その日時が来るまで表示しない
        .filter((post) => post.publishDate.getTime() <= now);
    })();
  }
  return _posts;
}

// ---- 講座 ----
export interface Course {
  pageId: string; // 申込フォームから講座を指定するのに使う
  name: string;
  type: string; // 養成講座 / セッション
  category: string; // グルーピング用の主カテゴリ（categories の先頭）
  categories: string[]; // カテゴリ（マルチセレクト全値）
  arts: string[]; // 占術（タロット/手相/占星術 など）
  instructor: string; // 講師名（' / ' 連結）
  instructors: { name: string; id: string }[]; // 個別ページリンク用
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

// 講師DB全件（公開/非公開問わず）から pageId → {氏名, id} のマップ
let _instrMap: Promise<Map<string, { name: string; id: string }>> | null = null;
function getInstructorMap(): Promise<Map<string, { name: string; id: string }>> {
  if (!_instrMap) {
    _instrMap = (async () => {
      const rows = await queryAll(INSTR_DB);
      const m = new Map<string, { name: string; id: string }>();
      for (const r of rows) {
        m.set(r.id, { name: pText(r.properties['名前']), id: pText(r.properties['id']) });
      }
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
          // 「種別」は廃止。カテゴリに「養成講座」が含まれるかで養成講座を判定する
          const cats = pMulti(p['カテゴリ']);
          const isCert = cats.includes('養成講座');
          const type = isCert ? '養成講座' : 'セッション';
          let curriculum: string[] = [];
          if (isCert) {
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
          const instrs = pRelIds(p['担当講師'])
            .map((id: string) => instrMap.get(id))
            .filter(Boolean) as { name: string; id: string }[];
          return {
            pageId: r.id,
            name: pText(p['講座名']),
            type,
            category: cats[0] ?? '',
            categories: cats,
            arts: pMulti(p['占術']),
            instructor: instrs.map((x) => x.name).join(' / '),
            instructors: instrs,
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
  return localizeHtml(await marked.parse(md));
}

/** 任意のNotionページ本文をHTMLで返す（空なら ''）。画像URLはローカル化。 */
export async function getPageBodyHtml(pageId: string): Promise<string> {
  try {
    const mdblocks = await n2m.pageToMarkdown(pageId);
    const md = (n2m.toMarkdownString(mdblocks).parent ?? '').trim();
    if (!md) return '';
    return localizeHtml((await marked.parse(md)).trim());
  } catch {
    return '';
  }
}

/** スタッフ（講師DBページ）の本文＝自己紹介をHTMLで返す（空なら ''） */
export async function getAuthorBioHtml(pageId: string): Promise<string> {
  return getPageBodyHtml(pageId);
}

// ---- 会員の声（受講生の感想・実績） ----
export interface Voice {
  name: string;
  role: string;
  image: string;
  result: string;
  comment: string;
  courses: string[];
  order: number;
}

let _voices: Promise<Voice[]> | null = null;

/** 掲載許可＋公開の両方にチェックがある声だけを表示順で返す */
export function getVoices(): Promise<Voice[]> {
  if (!_voices) {
    _voices = (async () => {
      const rows = await queryAll(VOICE_DB, {
        filter: {
          and: [
            { property: '公開', checkbox: { equals: true } },
            { property: '掲載許可', checkbox: { equals: true } },
          ],
        },
        sorts: [{ property: '表示順', direction: 'ascending' }],
      });
      // 受講講座（リレーション）→ 講座名
      const courses = await getCourses();
      const courseMap = new Map(courses.map((c) => [c.pageId, c.name]));
      return rows.map((r) => {
        const p = r.properties;
        return {
          name: pText(p['表示名']),
          role: pText(p['肩書き']),
          image: localizeImage(pFile(p['顔写真'])),
          result: pText(p['実績']),
          comment: pText(p['感想']),
          courses: pRelIds(p['受講講座'])
            .map((id: string) => courseMap.get(id))
            .filter(Boolean) as string[],
          order: p['表示順']?.number ?? 0,
        } as Voice;
      });
    })();
  }
  return _voices;
}

// ---- イベント（定例会・セミナー等） ----
export interface EventItem {
  pageId: string;
  name: string;
  type: string; // 定例会 / スキルアップ講座 / リーディング会 / ロープレ / マルシェ・イベント / zoom解放日
  date: string; // ISO（開始）
  end: string; // ISO（終了・任意）
  accepting: boolean; // 受付中
  url: string; // 案内URL
  memo: string;
  body: string; // ページ本文（「開く」で書いた詳細）のHTML
}

let _events: Promise<EventItem[]> | null = null;

/** イベント一覧（開催日の昇順）。※合言葉などの内部情報は返さない */
export function getEvents(): Promise<EventItem[]> {
  if (!_events) {
    _events = (async () => {
      const rows = await queryAll(EVENT_DB, {
        sorts: [{ property: '開催日', direction: 'ascending' }],
      });
      return Promise.all(
        rows.map(async (r) => {
          const p = r.properties;
          return {
            pageId: r.id,
            name: pText(p['イベント名']),
            type: pSelect(p['種別']),
            date: p['開催日']?.date?.start ?? '',
            end: p['開催日']?.date?.end ?? '',
            accepting: pCheckbox(p['受付中']),
            url: p['案内URL']?.url ?? '',
            memo: pText(p['メモ']),
            body: await getPageBodyHtml(r.id),
          } as EventItem;
        })
      );
    })();
  }
  return _events;
}

// ---- 今週の題材（一斉リーディング会のお題）＋会員の鑑定投稿 ----
export interface ThemeAnswer {
  penName: string;
  content: string;
  date: string;
}
export interface Theme {
  pageId: string;
  title: string;
  desc: string;
  current: boolean; // 今週
  date: string;
  birth: string; // 相談者の生年月日
  youtube: string;
  image: string; // 手相などの添付画像（ローカル化済み）
  answers: ThemeAnswer[]; // 公開可の回答のみ
}

let _themes: Promise<Theme[]> | null = null;

/** お題一覧（公開のみ・日付降順）。各お題に公開可の回答をぶら下げる */
export function getThemes(): Promise<Theme[]> {
  if (!_themes) {
    _themes = (async () => {
      const rows = await queryAll(THEME_DB, {
        filter: { property: '公開', checkbox: { equals: true } },
        sorts: [{ property: '日付', direction: 'descending' }],
      });
      // 公開可の回答をまとめて取得し、お題ごとに束ねる
      const ans = await queryAll(THEME_ANSWER_DB, {
        filter: { property: '公開可', checkbox: { equals: true } },
        sorts: [{ property: '投稿日', direction: 'ascending' }],
      });
      const byTheme = new Map<string, ThemeAnswer[]>();
      for (const a of ans) {
        const p = a.properties;
        const tid = p['お題']?.relation?.[0]?.id;
        if (!tid) continue;
        const list = byTheme.get(tid) ?? [];
        list.push({
          penName: pText(p['ペンネーム']) || '匿名',
          content: pText(p['鑑定内容']),
          date: pDate(p['投稿日']),
        });
        byTheme.set(tid, list);
      }
      return rows.map((r) => {
        const p = r.properties;
        return {
          pageId: r.id,
          title: pText(p['題材']),
          desc: pText(p['説明']),
          current: pCheckbox(p['今週']),
          date: pDate(p['日付']),
          birth: pText(p['生年月日']),
          youtube: p['YouTubeURL']?.url ?? '',
          image: localizeImage(pFile(p['画像'])),
          answers: byTheme.get(r.id) ?? [],
        } as Theme;
      });
    })();
  }
  return _themes;
}

// ---- クイズ（占術別）※正解・解説はクライアントに出さない（採点はGAS） ----
export interface QuizQuestion {
  id: string;
  q: string;
  choices: string[];
}
export interface QuizArt {
  art: string;
  questions: QuizQuestion[];
}

let _quiz: Promise<QuizArt[]> | null = null;

/** 公開中のクイズを占術別にまとめて返す（正解・解説は含めない） */
export function getQuiz(): Promise<QuizArt[]> {
  if (!_quiz) {
    _quiz = (async () => {
      const rows = await queryAll(QUIZ_DB, {
        filter: { property: '公開', checkbox: { equals: true } },
        sorts: [{ property: '表示順', direction: 'ascending' }],
      });
      const byArt = new Map<string, QuizQuestion[]>();
      for (const r of rows) {
        const p = r.properties;
        const art = pSelect(p['占術']) || 'その他';
        const choices = [
          pText(p['選択肢1']), pText(p['選択肢2']),
          pText(p['選択肢3']), pText(p['選択肢4']),
        ].filter((c) => c !== '');
        if (!pText(p['問題']) || choices.length < 2) continue;
        const list = byArt.get(art) ?? [];
        list.push({ id: r.id, q: pText(p['問題']), choices });
        byArt.set(art, list);
      }
      return [...byArt.entries()].map(([art, questions]) => ({ art, questions }));
    })();
  }
  return _quiz;
}

// ---- Instagram 埋め込み投稿 ----
export interface InstaPost {
  title: string;
  url: string;
  shortcode: string; // 埋め込みURL生成に使う
}

/** 投稿URLから shortcode を取り出す（/p/ /reel/ /tv/ に対応） */
function instaShortcode(url: string): string {
  const m = String(url).match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

let _insta: Promise<InstaPost[]> | null = null;

/** 公開中のInstagram投稿（表示順）。埋め込み可能なものだけ返す */
export function getInstaPosts(): Promise<InstaPost[]> {
  if (!_insta) {
    _insta = (async () => {
      const rows = await queryAll(INSTA_DB, {
        filter: { property: '公開', checkbox: { equals: true } },
        sorts: [{ property: '表示順', direction: 'ascending' }],
      });
      return rows
        .map((r) => {
          const p = r.properties;
          const url = p['投稿URL']?.url ?? '';
          return {
            title: pText(p['タイトル']),
            url,
            shortcode: instaShortcode(url),
          } as InstaPost;
        })
        .filter((x) => x.shortcode);
    })();
  }
  return _insta;
}
