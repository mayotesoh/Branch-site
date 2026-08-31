/**
 * Notionにアップした画像を、ビルド前にサイト側へ取り込むスクリプト。
 *
 * Notionの画像URL（S3の署名付きURL）は約1時間で期限切れになるため、そのまま
 * サイトに埋め込むと、しばらくして画像が表示されなくなります（404）。そこで
 * ビルドのたびに
 *   1. Notionから画像を public/notion/ にダウンロード（幅1600pxに縮小＋圧縮）
 *   2. 「元のURL(署名なし) → ローカルのパス」の対応表を
 *      src/data/notion-images.json に保存
 * しておき、サイト側はローカルの画像を表示します（src/lib/notion.ts の localizeImage）。
 *
 * 対象DB: ブログ / スタッフ(講師) / 会員の声
 * npm run build から自動で実行されます。鍵が無い・失敗してもビルドは止めません。
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

const API_KEY = process.env.NOTION_TOKEN;
const OUT_DIR = 'public/notion';
const MAP_PATH = 'src/data/notion-images.json';

// src/lib/notion.ts と同じID。本文中の画像も拾うDBは withBlocks: true。
const DATABASES = [
  { id: '04e8f32855ae4e80865ab3f2b92798cb', withBlocks: true }, // ブログ
  { id: '30e989297ce14ea99cbea84a2e5e2180', withBlocks: true }, // スタッフ(講師)：顔写真＋自己紹介本文
  { id: '3a776a170aae81e88abbd889d401e589', withBlocks: false }, // 会員の声：顔写真
];

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

/** Notionが署名付きURLを発行するホストかどうか */
const isNotionFile = (url) =>
  /prod-files-secure|secure\.notion-static\.com|s3\..*amazonaws\.com/.test(url);

/** クエリ（署名）を除いた部分をキーにする */
const keyOf = (url) => url.split('?')[0];

async function api(url, init) {
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function queryDatabase(dbId) {
  const all = [];
  let cursor;
  for (let i = 0; i < 50; i++) {
    const data = await api(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
    });
    all.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return all;
}

async function fetchBlocks(blockId, depth = 0) {
  const all = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
    url.searchParams.set('page_size', '100');
    if (cursor) url.searchParams.set('start_cursor', cursor);
    const data = await api(url.toString());
    all.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  if (depth < 2) {
    for (const b of all) {
      if (b.has_children) all.push(...(await fetchBlocks(b.id, depth + 1)));
    }
  }
  return all;
}

/** ページから画像URLを集める（カバー・ファイルプロパティ＝顔写真/カバー画像など） */
function collectFromPage(page) {
  const urls = [];
  const cover = page.cover;
  if (cover?.type === 'file' && cover.file?.url) urls.push(cover.file.url);

  for (const prop of Object.values(page.properties || {})) {
    if (prop?.type === 'files') {
      for (const f of prop.files || []) {
        if (f.type === 'file' && f.file?.url) urls.push(f.file.url);
      }
    }
  }
  return urls;
}

function collectFromBlocks(blocks) {
  const urls = [];
  for (const b of blocks) {
    if (b.type === 'image' && b.image?.type === 'file' && b.image.file?.url) {
      urls.push(b.image.file.url);
    }
    if (b.type === 'video' && b.video?.type === 'file' && b.video.file?.url) {
      urls.push(b.video.file.url);
    }
  }
  return urls;
}

async function download(url) {
  const key = keyOf(url);
  const srcExt = (path.extname(new URL(key).pathname) || '.jpg').toLowerCase();
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // 写真はスマホでも軽く表示できるよう、幅1600pxまで縮小して圧縮する
  const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(srcExt);
  if (isImage && srcExt !== '.gif') {
    try {
      // 透過のないPNG（スクリーンショットなど）はJPEGにすると大幅に軽くなる
      const meta = await sharp(buf).metadata();
      const keepPng = srcExt === '.png' && meta.hasAlpha;
      const pipeline = sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true });
      const out = keepPng
        ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
        : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      const name = hash + (keepPng ? '.png' : '.jpg');
      await writeFile(path.join(OUT_DIR, name), out);
      return { name, size: out.length };
    } catch {
      // 画像として扱えなかった場合はそのまま保存
    }
  }

  const name = hash + srcExt.slice(0, 5);
  await writeFile(path.join(OUT_DIR, name), buf);
  return { name, size: buf.length };
}

async function main() {
  if (!API_KEY) {
    console.log('[images] NOTION_TOKEN が未設定のため、画像の取り込みはスキップします。');
    await mkdir(path.dirname(MAP_PATH), { recursive: true });
    await writeFile(MAP_PATH, '{}\n');
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(path.dirname(MAP_PATH), { recursive: true });

  const urls = new Set();

  for (const db of DATABASES) {
    let pages = [];
    try {
      pages = await queryDatabase(db.id);
    } catch (e) {
      console.warn('[images] DB取得に失敗:', db.id, e.message);
      continue;
    }
    for (const page of pages) {
      collectFromPage(page).forEach((u) => urls.add(u));
      if (db.withBlocks) {
        try {
          const blocks = await fetchBlocks(page.id);
          collectFromBlocks(blocks).forEach((u) => urls.add(u));
        } catch (e) {
          console.warn('[images] 本文の取得に失敗:', page.id, e.message);
        }
      }
    }
  }

  const map = {};
  let ok = 0;
  let bytes = 0;
  for (const url of urls) {
    if (!isNotionFile(url)) continue;
    try {
      const { name, size } = await download(url);
      map[keyOf(url)] = `/notion/${name}`;
      ok++;
      bytes += size;
    } catch (e) {
      console.warn('[images] ダウンロード失敗:', keyOf(url).slice(0, 80), e.message);
    }
  }

  await writeFile(MAP_PATH, JSON.stringify(map, null, 2) + '\n');

  // 使われなくなった画像を掃除する
  const keep = new Set(Object.values(map).map((p) => path.basename(p)));
  for (const f of await readdir(OUT_DIR)) {
    if (!keep.has(f)) await unlink(path.join(OUT_DIR, f));
  }

  console.log(`[images] Notionの画像を取り込みました: ${ok}件 / ${Math.round(bytes / 1024)}KB`);
}

main().catch((e) => {
  // 画像の取り込みに失敗しても、ビルド自体は止めない
  console.warn('[images] 取り込みに失敗しました:', e.message);
});
