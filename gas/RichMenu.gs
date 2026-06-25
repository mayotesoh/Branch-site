/**
 * Branch ─ LINE リッチメニュー作成（小サイズ・1枠）
 * ----------------------------------------------------------------------
 * サイズ: 2500 × 843 px（小）。全面1枠をタップで予約フローを開始します。
 *
 * ■ 一番かんたんな方法（コード不要・推奨）
 *   LINE公式アカウントマネージャー → ホーム → リッチメニュー → 作成
 *   - テンプレート: 「小」 → 1枠のもの
 *   - 画像: 2500×843 の PNG/JPEG（public/richmenu.svg をPNG書き出ししてもOK）
 *   - アクション: 「テキスト」→ 内容を「予約」にする
 *   ※ タップすると「予約」が送信され、ボットが予約フローを開始します。
 *
 * ■ APIで作る方法（このファイルの関数を使う場合）
 *   1) createReserveRichMenu() を実行 → ログに richMenuId が出る
 *   2) 画像をGoogleドライブに置き、そのファイルIDで
 *      uploadRichMenuImage(richMenuId, imageFileId) を実行
 *   3) setDefaultRichMenu(richMenuId) を実行して全員に適用
 *   ※ LINE_CHANNEL_ACCESS_TOKEN は LineBot.gs の定数を共有します。
 * ----------------------------------------------------------------------
 */

function createReserveRichMenu() {
  const richMenu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: '予約メニュー',
    chatBarText: 'メニューを開く',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 2500, height: 843 },
        action: { type: 'postback', data: 'action=reserve', displayText: '予約する' },
      },
    ],
  };

  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
    payload: JSON.stringify(richMenu),
    muteHttpExceptions: true,
  });
  Logger.log(res.getResponseCode() + ': ' + res.getContentText());
  // → 返ってきた {"richMenuId":"richmenu-xxxx"} を控える
}

/**
 * 画像をアップロード（2500×843 の PNG/JPEG, 1MB以下）
 * @param {string} richMenuId createReserveRichMenu() で得たID
 * @param {string} imageFileId Googleドライブ上の画像ファイルID
 */
function uploadRichMenuImage(richMenuId, imageFileId) {
  const blob = DriveApp.getFileById(imageFileId).getBlob();
  const res = UrlFetchApp.fetch(
    'https://api-data.line.me/v2/bot/richmenu/' + richMenuId + '/content',
    {
      method: 'post',
      contentType: blob.getContentType(), // image/png or image/jpeg
      headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
      payload: blob.getBytes(),
      muteHttpExceptions: true,
    }
  );
  Logger.log(res.getResponseCode() + ': ' + res.getContentText());
}

/**
 * 全ユーザーのデフォルトリッチメニューに設定
 */
function setDefaultRichMenu(richMenuId) {
  const res = UrlFetchApp.fetch(
    'https://api.line.me/v2/bot/user/all/richmenu/' + richMenuId,
    {
      method: 'post',
      headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
      muteHttpExceptions: true,
    }
  );
  Logger.log(res.getResponseCode() + ': ' + res.getContentText());
}

/** 既存リッチメニュー一覧（確認用） */
function listRichMenus() {
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/list', {
    headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
    muteHttpExceptions: true,
  });
  Logger.log(res.getContentText());
}
