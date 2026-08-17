/**
 * Fortune Labo ─ LINE Messaging API（最小構成）
 * ----------------------------------------------------------------------
 * ステップ式の予約ボットは廃止（予約・申込はサイトから）。
 * このスクリプトの役割は次の2つだけ：
 *   1) 「ID」と送られたら、その会話の userId / groupId を返す（通知先の取得用）
 *   2) 決済完了などで運営（LINE_ADMIN_TARGET）へプッシュ通知する（他ファイルから呼ばれる）
 * 通常のメッセージには一切反応しない＝手動チャットの邪魔をしない。
 * ----------------------------------------------------------------------
 */

// チャネルアクセストークン：スクリプトプロパティ LINE_CHANNEL_ACCESS_TOKEN を優先
const LINE_CHANNEL_ACCESS_TOKEN =
  PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '';

/** Webhook 本体（Code.gs の doPost から呼ばれる） */
function handleLineWebhook(data) {
  data.events.forEach(function (ev) {
    try { handleLineEvent(ev); } catch (err) { console.error('LINE event error: ' + err); }
  });
}

function handleLineEvent(ev) {
  // 「ID」だけに反応（通知先セットアップ用）。それ以外は完全に無視。
  if (ev.type === 'message' && ev.message && ev.message.type === 'text' && ev.replyToken) {
    const t = ev.message.text.trim().toUpperCase();
    if (t === 'ID' || t === 'ＩＤ' || t === '通知先') {
      const src = ev.source || {};
      const id = src.groupId || src.roomId || src.userId || '(取得不可)';
      const kind = src.groupId ? 'groupId（グループ）' : src.roomId ? 'roomId（複数トーク）' : 'userId（1対1）';
      replyText(ev.replyToken,
        '通知先ID（' + kind + '）:\n' + id +
        '\n\nこの値を スクリプトプロパティ「LINE_ADMIN_TARGET」に設定すると、決済完了時にここへ通知が届きます。');
      return;
    }
  }
  // それ以外は何も返さない（手動チャット運用）
  return;
}

/* ---------------- LINE API ---------------- */

function lineToken_() {
  const p = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  return p || LINE_CHANNEL_ACCESS_TOKEN;
}

function replyText(replyToken, text) { replyMessage(replyToken, [{ type: 'text', text: text }]); }

function replyMessage(replyToken, messages) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + lineToken_() },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true,
  });
}

/* ---------------- 運営向けプッシュ通知（他ファイルから利用） ---------------- */

function pushLineText_(to, text) {
  if (!to) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + lineToken_() },
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    muteHttpExceptions: true,
  });
}

/**
 * 運営（公式LINE）へ通知。宛先はスクリプトプロパティ LINE_ADMIN_TARGET（カンマ区切りで複数可）。
 */
function notifyAdminLine_(text) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('LINE_ADMIN_TARGET');
    if (!raw) { console.warn('LINE_ADMIN_TARGET 未設定のため運営通知をスキップ'); return; }
    raw.split(',').map(function (s) { return s.trim(); }).filter(String).forEach(function (to) { pushLineText_(to, text); });
  } catch (e) { console.error('運営LINE通知エラー: ' + e); }
}
