/**
 * 四半期の繰り越しスクリプト
 * ----------------------------------------------------------------------
 * 新しい四半期に切り替えるとき、次を自動で行う（100人規模でも数十秒）:
 *   1. 旧四半期の行の「今期」チェックを外す
 *   2. 活動中の会員全員ぶん、新四半期の行を作成（「今期」ON）
 *   3. すでに行がある会員はスキップ（何度実行しても安全）
 *
 * 使い方:
 *   node scripts/quarter-rollover.mjs 2026-Q4
 *   node scripts/quarter-rollover.mjs 2026-Q4 --dry-run   （確認のみ・書き込みなし）
 *
 * NOTION_TOKEN は .env から読み込みます。
 * ----------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';

const MEMBER_DB = 'ca1b82cb-70c3-4995-b15b-362181c387cd';
const SCORE_DB = '3a776a17-0aae-81a0-8708-d1e6c4d245f7';

// 新規行を作らない会員ステータス
const SKIP_STATUS = ['退会', '見込み'];

const quarter = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!quarter || !/^\d{4}-Q[1-4]$/.test(quarter)) {
  console.error('使い方: node scripts/quarter-rollover.mjs 2026-Q4 [--dry-run]');
  process.exit(1);
}

const envPath = path.resolve(process.cwd(), '.env');
const token = (fs.readFileSync(envPath, 'utf-8').match(/NOTION_TOKEN=(.+)/) || [])[1]?.trim();
if (!token) {
  console.error('.env に NOTION_TOKEN がありません。');
  process.exit(1);
}
const h = {
  Authorization: 'Bearer ' + token,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

const api = async (url, opts = {}) => {
  const res = await fetch('https://api.notion.com/v1/' + url, { headers: h, ...opts });
  const body = await res.json();
  if (body.object === 'error') throw new Error(`${body.code}: ${body.message}`);
  return body;
};

/** ページネーション対応の全件取得 */
async function queryAll(dbId, filter) {
  const out = [];
  let cursor;
  do {
    const body = await api(`databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify({ page_size: 100, start_cursor: cursor, ...(filter ? { filter } : {}) }),
    });
    out.push(...body.results);
    cursor = body.has_more ? body.next_cursor : undefined;
  } while (cursor);
  return out;
}

const plain = (rt) => (rt || []).map((t) => t.plain_text).join('');

(async () => {
  console.log(`▶ ${quarter} へ繰り越し${dryRun ? '（ドライラン）' : ''}\n`);

  // 選択肢に新四半期が無ければ追加
  const sdb = await api('databases/' + SCORE_DB);
  const opts = sdb.properties['四半期'].select.options || [];
  if (!opts.some((o) => o.name === quarter)) {
    if (!dryRun) {
      await api('databases/' + SCORE_DB, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: { 四半期: { select: { options: [...opts.map((o) => ({ name: o.name })), { name: quarter }] } } },
        }),
      });
    }
    console.log(`  選択肢に ${quarter} を追加`);
  }

  // 既存スコア行
  const allScores = await queryAll(SCORE_DB);
  const already = new Set(
    allScores
      .filter((p) => p.properties['四半期']?.select?.name === quarter)
      .map((p) => p.properties['会員']?.relation?.[0]?.id)
      .filter(Boolean)
  );

  // 1) 旧四半期の「今期」を外す
  const toUncheck = allScores.filter(
    (p) => p.properties['四半期']?.select?.name !== quarter && p.properties['今期']?.checkbox === true
  );
  for (const p of toUncheck) {
    if (!dryRun) {
      await api('pages/' + p.id, {
        method: 'PATCH',
        body: JSON.stringify({ properties: { 今期: { checkbox: false } } }),
      });
    }
  }
  console.log(`  旧四半期の「今期」を解除: ${toUncheck.length}件`);

  // 2) 活動中の会員に新四半期の行を作成
  const members = await queryAll(MEMBER_DB);
  let created = 0;
  let skipped = 0;
  for (const m of members) {
    const name = plain(m.properties['氏名']?.title) || '(無題)';
    const status = m.properties['会員ステータス']?.select?.name || '';
    if (SKIP_STATUS.includes(status)) { skipped++; continue; }
    if (already.has(m.id)) { skipped++; continue; }

    if (!dryRun) {
      await api('pages', {
        method: 'POST',
        body: JSON.stringify({
          parent: { database_id: SCORE_DB },
          properties: {
            スコア記録: { title: [{ text: { content: `${quarter} ${name}` } }] },
            会員: { relation: [{ id: m.id }] },
            四半期: { select: { name: quarter } },
            今期: { checkbox: true },
          },
        }),
      });
    }
    created++;
  }

  console.log(`  新規作成: ${created}件 / スキップ: ${skipped}件（既存・退会・見込み）`);
  console.log(`\n✓ 完了${dryRun ? '（何も書き込んでいません）' : ''}`);
})().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
