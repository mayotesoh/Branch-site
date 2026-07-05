/**
 * Branch ─ 予約を Notion「予約管理DB」へ同期する
 * ----------------------------------------------------------------------
 * appendReservation() から呼ばれ、スプレッドシート追記と“併せて”
 * Notion にも1ページ作成します。失敗してもスプシ記録は成立するよう、
 * 呼び出し側で try/catch して握りつぶします（記録優先）。
 *
 * 【セットアップ】
 *  1. Notion インテグレーションのトークンを、Apps Script の
 *     「プロジェクトの設定 → スクリプト プロパティ」に登録:
 *        キー:  NOTION_TOKEN
 *        値:   ntn_xxxxxxxx...
 *  2. 予約管理DB をそのインテグレーションに「コネクト」しておく。
 *  3. testNotionSync() を実行して 200 が返るか確認。
 * ----------------------------------------------------------------------
 */

// 予約管理DB の Database ID（機密ではない）
const NOTION_RESERVATION_DB = '1af355e63369400c972433d81da49259';
const NOTION_VERSION = '2022-06-28';

/**
 * Script Properties から Notion トークンを取得
 */
function getNotionToken_() {
  return PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
}

/**
 * 予約1件を Notion 予約管理DB に作成
 * @param {{userName:string,userId:string,email:string,date:string,time:string,content:string}} r
 */
function syncReservationToNotion(r) {
  const token = getNotionToken_();
  if (!token) {
    // 未設定なら何もしない（スプシ記録は継続）
    console.warn('NOTION_TOKEN 未設定のため Notion 同期をスキップ');
    return;
  }

  const properties = {
    '予約者': { title: [{ text: { content: r.userName || '（名称未設定）' } }] },
    'userId': { rich_text: [{ text: { content: r.userId || '' } }] },
    '時間': { rich_text: [{ text: { content: r.time || '' } }] },
    'ステータス': { select: { name: '未対応' } },
  };
  if (r.email) properties['メール'] = { email: r.email };
  if (r.date) properties['日付'] = { date: { start: r.date } };
  if (r.content) properties['コンテンツ'] = { select: { name: r.content } };

  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': NOTION_VERSION,
    },
    payload: JSON.stringify({
      parent: { database_id: NOTION_RESERVATION_DB },
      properties: properties,
    }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    // 呼び出し側の try/catch に拾わせる
    throw new Error('Notion同期エラー ' + code + ': ' + res.getContentText());
  }
}

/**
 * 【動作確認用】テスト予約を1件 Notion に作成する
 */
function testNotionSync() {
  syncReservationToNotion({
    userName: 'テスト予約',
    userId: 'test-' + new Date().getTime(),
    email: 'test@example.com',
    date: '2026-07-10',
    time: '14:00',
    content: '体験講座',
  });
  console.log('OK: Notion にテスト予約を作成しました');
}
