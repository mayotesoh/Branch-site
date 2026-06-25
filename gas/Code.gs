/**
 * Branch ─ 予約受付 Google Apps Script（ルーター / フォーム処理）
 * ----------------------------------------------------------------------
 * 1つの doPost で 2種類のリクエストを受け付けます:
 *   (A) サイトの予約フォーム / LIFF からの JSON（text/plain）
 *   (B) LINE Messaging API の Webhook（対話式予約） … LineBot.gs で処理
 *
 * スプレッドシートの列:
 *   タイムスタンプ | userName | userId | メールアドレス | date | time | コンテンツ
 * ----------------------------------------------------------------------
 */

// 予約データを書き込むスプレッドシートID
const SPREADSHEET_ID = '1bsp2ZZVIA_VplkT1eCt0rUmbYOmIIn9I3dIgem4fA7Y';

// 見出し行（userId と date の間に「メールアドレス」、末尾に「コンテンツ」）
const HEADERS = [
  'タイムスタンプ',
  'userName',
  'userId',
  'メールアドレス',
  'date',
  'time',
  'コンテンツ',
];

/**
 * POST エントリーポイント（ルーター）
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('リクエストボディが空です。');
    }

    const data = JSON.parse(e.postData.contents);

    // (B) LINE Webhook（events 配列を含む）→ 対話式予約へ
    if (data && data.events && Array.isArray(data.events)) {
      handleLineWebhook(data); // LineBot.gs
      return jsonOutput({ status: 'ok' }); // LINEには200を返せばOK
    }

    // (A) フォーム / LIFF からの予約
    return handleFormReservation(data);
  } catch (err) {
    return jsonOutput({
      status: 'error',
      message: (err && err.message) ? err.message : String(err),
    });
  }
}

/**
 * サイトフォーム / LIFF からの予約を処理
 */
function handleFormReservation(data) {
  const userName = (data.userName || '').toString();
  const userId = (data.userId || '').toString();
  const email = (data.email || '').toString();
  const content = (data.content || '').toString();
  const date = (data.date || '').toString();
  const time = (data.time || '').toString();

  // 必須チェック
  if (!userId || !content || !date || !time) {
    throw new Error('必須項目が不足しています（userId / content / date / time）。');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('メールアドレスの形式が不正です。');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date の形式が不正です（YYYY-MM-DD）。');
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('time の形式が不正です（HH:MM）。');
  }

  appendReservation({ userName, userId, email, date, time, content });
  return jsonOutput({ status: 'success' });
}

/**
 * 予約1行をスプレッドシートに追記（フォーム / LINE 共通）
 * @param {{userName:string,userId:string,email:string,date:string,time:string,content:string}} r
 */
function appendReservation(r) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }
    sheet.appendRow([
      new Date(),
      r.userName || '',
      r.userId || '',
      r.email || '',
      r.date || '',
      r.time || '',
      r.content || '',
    ]);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 【1回だけ手動実行】既存シートを新しい見出し仕様に作り直す。
 * ※ 既存データはすべて消えます。テスト行を消したいときに実行してください。
 */
function resetHeaders() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0];
  sheet.clear();
  sheet.appendRow(HEADERS);
}

/**
 * GET: 動作確認用
 */
function doGet() {
  return jsonOutput({ status: 'ok', message: 'Branch 予約API は稼働中です。' });
}

/**
 * JSON レスポンス共通関数
 */
function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
