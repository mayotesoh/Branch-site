/**
 * Branch ─ スコア入力シート ⇄ Notion 連携
 * ----------------------------------------------------------------------
 * Notion を触らずに、スプレッドシートだけでスコアを入力できるようにする。
 *
 * 【方式】列ごとに「正」を固定するので、衝突（どちらが正しいか不明）が起きない
 *   ・スコア18項目          … スプレッドシートが正 → Notionへ反映
 *   ・会員名 / 四半期 / 合計点 … Notionが正        → スプレッドシートへ表示
 *
 * 【使い方】スプレッドシート上部のメニュー「Notion連携」から
 *   1. 初期設定（シートを作る）… 最初に1回だけ
 *   2. Notionから取得          … 名簿と現在値をシートに読み込む
 *   3. Notionへ反映            … シートで入力した点数をNotionに書き戻す
 *
 * 【セットアップ】
 *   拡張機能 → Apps Script を開き、このファイルを貼り付け、
 *   「プロジェクトの設定 → スクリプト プロパティ」に登録:
 *       NOTION_TOKEN = ntn_xxxxxxxx...
 * ----------------------------------------------------------------------
 */

const MEMBER_DB = 'ca1b82cb-70c3-4995-b15b-362181c387cd';
const SCORE_DB = '3a776a17-0aae-80f5-9243-cab17a49a0d2';
const NOTION_VER = '2022-06-28';

const SHEET_INPUT = 'スコア入力';
const SHEET_CONFIG = '設定';
const SHEET_SNAP = '_snapshot'; // 差分判定用（非表示）

// スプレッドシートが「正」の入力項目
const QUANT = [
  '月収(万円)', '認定試験の点数', 'zoom解放日の出席率', '定例会参加数',
  'スキルアップ講座受講数', 'マルシェやイベント参加数', '外部マルシェ出店経験',
  'リーディング会参加数', 'ロープレ参加数', 'ロープレ時お客様役回数',
  'コミュニティ紹介数', '動員数', '集客人数',
];
const QUAL = ['即行動', '我流じゃない', 'ポジティブ', '陰の気を出していない', 'レスポンス早い'];

// 列構成： A:ページID  B:会員名  C:四半期  D〜:入力項目  末尾:合計点
const COL_ID = 1, COL_NAME = 2, COL_QUARTER = 3, COL_INPUT_START = 4;
const HEADERS = ['NotionページID(触らない)', '会員名', '四半期', ...QUANT, ...QUAL, '合計点(自動)'];

/** メニューを追加 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Notion連携')
    .addItem('① 初期設定（シートを作る）', 'setupSheets')
    .addSeparator()
    .addItem('② Notionから取得', 'pullFromNotion')
    .addItem('③ Notionへ反映', 'pushToNotion')
    .addToUi();
}

function token_() {
  const t = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!t) throw new Error('スクリプトプロパティに NOTION_TOKEN が設定されていません。');
  return t;
}

function notion_(path, method, payload) {
  const res = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, {
    method: method || 'get',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token_(), 'Notion-Version': NOTION_VER },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('Notion API: ' + (body.message || res.getResponseCode()));
  }
  return body;
}

/** ページネーション対応クエリ */
function queryAll_(dbId, filter) {
  const out = [];
  let cursor = undefined;
  do {
    const body = notion_('databases/' + dbId + '/query', 'post', {
      page_size: 100, start_cursor: cursor, filter: filter || undefined,
    });
    body.results.forEach(function (r) { out.push(r); });
    cursor = body.has_more ? body.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** ① 初期設定：シートと見出しを作る */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let cfg = ss.getSheetByName(SHEET_CONFIG) || ss.insertSheet(SHEET_CONFIG);
  cfg.getRange('A1').setValue('対象の四半期');
  if (!cfg.getRange('B1').getValue()) cfg.getRange('B1').setValue('2026-Q3');
  cfg.getRange('A3').setValue('※ B1 を書き換えてから「Notionから取得」を実行してください');

  let sh = ss.getSheetByName(SHEET_INPUT) || ss.insertSheet(SHEET_INPUT);
  sh.clear();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  sh.hideColumns(COL_ID); // ページIDは触らせない
  // 〇△✖ はプルダウンに
  const qualStart = COL_INPUT_START + QUANT.length;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(['〇', '△', '✖'], true).build();
  sh.getRange(2, qualStart, 500, QUAL.length).setDataValidation(rule);
  // 合計点は自動なので色を変えて注意喚起
  sh.getRange(1, HEADERS.length).setBackground('#efefef');

  let snap = ss.getSheetByName(SHEET_SNAP) || ss.insertSheet(SHEET_SNAP);
  snap.hideSheet();

  SpreadsheetApp.getUi().alert('初期設定が完了しました。\n「設定」シートのB1で四半期を確認し、「② Notionから取得」を実行してください。');
}

/** ② Notion → シート（名簿・現在値・合計点を取得） */
function pullFromNotion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const quarter = String(ss.getSheetByName(SHEET_CONFIG).getRange('B1').getValue()).trim();
  if (!/^\d{4}-Q[1-4]$/.test(quarter)) throw new Error('「設定」B1 の四半期が不正です（例: 2026-Q3）');

  const rows = queryAll_(SCORE_DB, { property: '四半期', select: { equals: quarter } });
  if (!rows.length) {
    SpreadsheetApp.getUi().alert(quarter + ' の行が Notion にありません。先に四半期の繰り越しを実行してください。');
    return;
  }

  const data = rows.map(function (r) {
    const p = r.properties;
    const name = (p['スコア記録'].title || []).map(function (t) { return t.plain_text; }).join('')
      .replace(quarter + ' ', '');
    const line = [r.id, name, quarter];
    QUANT.forEach(function (k) { line.push(p[k] && typeof p[k].number === 'number' ? p[k].number : ''); });
    QUAL.forEach(function (k) { line.push(p[k] && p[k].select ? p[k].select.name : ''); });
    line.push(p['合計点'] && p['合計点'].formula ? p['合計点'].formula.number : '');
    return line;
  });
  data.sort(function (a, b) { return String(a[1]).localeCompare(String(b[1]), 'ja'); });

  const sh = ss.getSheetByName(SHEET_INPUT);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).clearContent();
  sh.getRange(2, 1, data.length, HEADERS.length).setValues(data);

  saveSnapshot_(data);
  SpreadsheetApp.getUi().alert(quarter + ' の ' + data.length + '名を読み込みました。');
}

/** ③ シート → Notion（変更のあった行だけ書き戻す） */
function pushToNotion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_INPUT);
  const last = sh.getLastRow();
  if (last < 2) { SpreadsheetApp.getUi().alert('データがありません。先に「Notionから取得」を実行してください。'); return; }

  const values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const snap = loadSnapshot_();
  const inputCount = QUANT.length + QUAL.length;

  let updated = 0, failed = 0;
  values.forEach(function (row) {
    const pageId = row[COL_ID - 1];
    if (!pageId) return;
    const current = row.slice(COL_INPUT_START - 1, COL_INPUT_START - 1 + inputCount).map(String);
    const before = snap[pageId];
    if (before && before.join('') === current.join('')) return; // 変更なし

    const props = {};
    QUANT.forEach(function (k, i) {
      const v = row[COL_INPUT_START - 1 + i];
      props[k] = { number: v === '' || v === null ? null : Number(v) };
    });
    QUAL.forEach(function (k, i) {
      const v = String(row[COL_INPUT_START - 1 + QUANT.length + i] || '').trim();
      props[k] = { select: v ? { name: v } : null };
    });

    try {
      notion_('pages/' + pageId, 'patch', { properties: props });
      updated++;
    } catch (e) {
      failed++;
      console.error(row[COL_NAME - 1] + ': ' + e.message);
    }
    Utilities.sleep(350); // レート制限（3req/秒）対策
  });

  SpreadsheetApp.getUi().alert(
    'Notionへ反映しました。\n更新: ' + updated + '件' + (failed ? ' / 失敗: ' + failed + '件（ログを確認）' : '') +
    '\n\n合計点を最新にするには「② Notionから取得」を実行してください。'
  );
  if (updated) pullFromNotion(); // 合計点を取り直す（スナップショットも更新される）
}

function saveSnapshot_(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const snap = ss.getSheetByName(SHEET_SNAP);
  snap.clear();
  const inputCount = QUANT.length + QUAL.length;
  const out = data.map(function (r) {
    return [r[COL_ID - 1]].concat(r.slice(COL_INPUT_START - 1, COL_INPUT_START - 1 + inputCount).map(String));
  });
  if (out.length) snap.getRange(1, 1, out.length, inputCount + 1).setValues(out);
}

function loadSnapshot_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const snap = ss.getSheetByName(SHEET_SNAP);
  const map = {};
  if (!snap || snap.getLastRow() === 0) return map;
  const inputCount = QUANT.length + QUAL.length;
  snap.getRange(1, 1, snap.getLastRow(), inputCount + 1).getValues().forEach(function (r) {
    if (r[0]) map[r[0]] = r.slice(1).map(String);
  });
  return map;
}
