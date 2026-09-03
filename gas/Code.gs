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

    // (C) 出席受付（合言葉フォーム）→ 参加記録＋スコア自動集計
    if (data && data.action === 'checkin') {
      return handleCheckin(data); // Attendance.gs
    }

    // (D) 講座の申込・決済 → 受講履歴＋得点に自動反映
    if (data && data.action === 'course_charge') {
      return handleCourseCharge(data); // CoursePayment.gs（PAY.JP課金 or 申込のみ）
    }

    // (E) 対面決済（現場QR）→ Checkout作成
    if (data && data.action === 'offline_create') {
      return handleOfflineCreate(data); // OfflinePayment.gs（対面決済レコード作成）
    }
    if (data && data.action === 'offline_charge') {
      return handleOfflineCharge(data); // OfflinePayment.gs（お客様がカードで支払い）
    }

    // (F) 会員ページ ログイン（会員番号＋暗証番号）→ スコア・評定を返す
    if (data && data.action === 'member_login') {
      return handleMemberLogin(data); // MemberPortal.gs
    }

    // (G) 会員ページ イベント予約（参加記録に「申込」を作成）
    if (data && data.action === 'event_reserve') {
      return handleEventReserve(data); // MemberPortal.gs
    }
    // (H) 会員ページ 出席確認（合言葉照合→参加記録を「出席」に）
    if (data && data.action === 'event_checkin') {
      return handleEventCheckin(data); // MemberPortal.gs
    }
    // (I) 会員ページ 予約キャンセル（申込の参加記録を削除）
    if (data && data.action === 'event_cancel') {
      return handleEventCancel(data); // MemberPortal.gs
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

  // Notion「予約管理DB」にも同期（失敗してもスプシ記録は成立させる）
  try {
    syncReservationToNotion(r); // NotionSync.gs
  } catch (err) {
    console.error('Notion同期に失敗しました: ' + (err && err.message ? err.message : err));
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
 * GET エントリーポイント
 *   ?action=offline_info&rid=…   … 対面決済レコードの金額等（お客様のカードページ用）
 *   ?action=offline_status&rid=… … 対面決済の入金状況（スタッフ画面のポーリング用）
 *   （それ以外）… 動作確認メッセージ
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === 'offline_info') {
      return getOfflineInfo((params.rid || '').toString()); // OfflinePayment.gs
    }
    if (params.action === 'offline_status') {
      return checkOfflineStatus((params.rid || '').toString()); // OfflinePayment.gs
    }
    return jsonOutput({ status: 'ok', message: 'Fortune Lab☆！ 予約API は稼働中です。' });
  } catch (err) {
    return jsonOutput({
      status: 'error',
      message: (err && err.message) ? err.message : String(err),
    });
  }
}

/**
 * JSON レスポンス共通関数
 */
function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
