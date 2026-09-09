import fs from 'node:fs';
import path from 'node:path';

const TOKEN = (fs.readFileSync('.env', 'utf8').match(/^NOTION_TOKEN=(.+)$/m) || [])[1]?.trim().replace(/^"|"$/g, '');
if (!TOKEN) { console.error('NOTION_TOKEN not found'); process.exit(1); }
const BLOG_DB = '04e8f32855ae4e80865ab3f2b92798cb';

const TITLE = '【定例会レポート】鑑定を"世界へ" ── 新プロジェクトと会員サイトが始動！';
const SLUG = 'teireikai-2026-09-09';
const EXCERPT = '9月9日の定例会レポート。鑑定を世界に届ける新プロジェクト、公式サイト＆会員ページの公開、勉強会「リーディングと鑑定は違う」、交流タイムの現場トークまで。';
const TAGS = ['定例会', '活動レポート', 'コミュニティ', '勉強会'];

const md = fs.readFileSync(path.join('tools', '_blog_draft.md'), 'utf8');

// --- inline **bold** parser -> rich_text[] ---
function rich(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: { content: text.slice(last, m.index) } });
    out.push({ type: 'text', text: { content: m[1] }, annotations: { bold: true } });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: 'text', text: { content: text.slice(last) } });
  return out.length ? out : [{ type: 'text', text: { content: text } }];
}

const blocks = [];
for (let raw of md.split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (!line.trim()) continue;
  if (line.startsWith('### ')) {
    blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rich(line.slice(4)) } });
  } else if (line.startsWith('## ')) {
    blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rich(line.slice(3)) } });
  } else if (line.startsWith('# ')) {
    blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: rich(line.slice(2)) } });
  } else if (line.startsWith('> ')) {
    blocks.push({ object: 'block', type: 'quote', quote: { rich_text: rich(line.slice(2)) } });
  } else if (line.startsWith('- ')) {
    blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(line.slice(2)) } });
  } else if (line.trim() === '---') {
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  } else {
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(line) } });
  }
}

console.log('blocks:', blocks.length);

async function notion(pathname, method, body) {
  const res = await fetch('https://api.notion.com/v1/' + pathname, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) { console.error('ERROR', res.status, JSON.stringify(json, null, 2)); process.exit(1); }
  return json;
}

const first = blocks.slice(0, 100);
const rest = blocks.slice(100);

const page = await notion('pages', 'POST', {
  parent: { database_id: BLOG_DB },
  properties: {
    'タイトル': { title: [{ text: { content: TITLE } }] },
    'slug': { rich_text: [{ text: { content: SLUG } }] },
    '公開状態': { select: { name: '下書き' } },
    '抜粋': { rich_text: [{ text: { content: EXCERPT } }] },
    'タグ': { multi_select: TAGS.map((name) => ({ name })) },
  },
  children: first,
});

console.log('created page:', page.id, page.url);

for (let i = 0; i < rest.length; i += 100) {
  await notion('blocks/' + page.id + '/children', 'PATCH', { children: rest.slice(i, i + 100) });
  console.log('appended', Math.min(i + 100, rest.length), '/', rest.length);
}
console.log('DONE');
