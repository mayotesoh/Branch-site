/**
 * Branch ─ LINE LIFF 予約データ受信用 Google Apps Script
 * ----------------------------------------------------------------------
 * LIFF アプリから送信された予約データ(JSON)を受け取り、
 * Google スプレッドシートに [タイムスタンプ, userName, userId, date, time]
 * を1行追記する Web API。
 *
 * ■ CORS について（重要）
 *   GAS の ContentService は任意のレスポンスヘッダー
 *   （Access-Control-Allow-Origin 等）を設定できません。
 *   そのため、ブラウザ(LIFF)側からの fetch では
 *   Content-Type を "application/json" にすると CORS プリフライト
 *   (OPTIONS) が走り、GAS 側で処理できずエラーになります。
 *
 *   ベストプラクティス:
 *   フロント側で Content-Type を "text/plain;charset=utf-8" にして
 *   送信する（＝「単純リクエスト」扱いになりプリフライトが発生しない）。
 *   ボディは JSON 文字列のまま送り、GAS 側で JSON.parse します。
 *   ※フロント側のサンプルは末尾コメント / README を参照。
 * ----------------------------------------------------------------------
 */

// 予約データを書き込むスプレッドシートID
const SPREADSHEET_ID = '1bsp2ZZVIA_VplkT1eCt0rUmbYOmIIn9I3dIgem4fA7Y';

// 見出し行（初回のみ自動で設定）
const HEADERS = ['タイムスタンプ', 'userName', 'userId', 'date', 'time'];

/**
 * POST: LIFF からの予約データを受け取り、シートに追記する
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('リクエストボディが空です。');
    }

    // text/plain で送られてきた JSON 文字列をパース
    const data = JSON.parse(e.postData.contents);

    const userName = (data.userName || '').toString();
    const userId = (data.userId || '').toString();
    const date = (data.date || '').toString();
    const time = (data.time || '').toString();

    // 必須項目チェック
    if (!userId || !date || !time) {
      throw new Error('必須項目が不足しています（userId / date / time）。');
    }

    // 形式チェック（YYYY-MM-DD / HH:MM）
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('date の形式が不正です（YYYY-MM-DD）。');
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      throw new Error('time の形式が不正です（HH:MM）。');
    }

    // 同時書き込みによる行の競合を防ぐ
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0];

      // 見出し行が無ければ追加
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(HEADERS);
      }

      sheet.appendRow([new Date(), userName, userId, date, time]);
    } finally {
      lock.releaseLock();
    }

    return jsonOutput({ status: 'success' });
  } catch (err) {
    return jsonOutput({
      status: 'error',
      message: (err && err.message) ? err.message : String(err),
    });
  }
}

/**
 * GET: 動作確認用（ブラウザでデプロイURLを開いたとき）
 */
function doGet(e) {
  return jsonOutput({ status: 'ok', message: 'Branch 予約API は稼働中です。' });
}

/**
 * JSON レスポンスを生成する共通関数
 */
function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
