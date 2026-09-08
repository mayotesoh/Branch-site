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
  if (!(ev.type === 'message' && ev.message && ev.message.type === 'text' && ev.replyToken)) return;
  const src = ev.source || {};
  const text = String(ev.message.text || '').trim();

  // 「ID」だけに反応（通知先セットアップ用・運営向け）
  const up = text.toUpperCase();
  if (up === 'ID' || up === 'ＩＤ' || text === '通知先') {
    const id = src.groupId || src.roomId || src.userId || '(取得不可)';
    const kind = src.groupId ? 'groupId（グループ）' : src.roomId ? 'roomId（複数トーク）' : 'userId（1対1）';
    replyText(ev.replyToken,
      '通知先ID（' + kind + '）:\n' + id +
      '\n\nこの値を スクリプトプロパティ「LINE_ADMIN_TARGET」に設定すると、決済完了時にここへ通知が届きます。');
    return;
  }

  // 会員向けログイン情報ヘルプ（1対1トークのみ）
  // ※ 氏名は秘密ではないため、自動でID/パスワードを開示・変更する仕組みは廃止。
  //    トリガー語に反応したら「運営が本人確認して対応する」旨を返し、運営へ通知する。
  const userId = src.userId;
  if (!userId || (src.type && src.type !== 'user')) return;

  if (mpIsIdTrigger_(text)) {
    replyText(ev.replyToken,
      'ログイン情報（会員番号・パスワード）についてですね。\n' +
      '安全のため、運営が本人確認のうえ、この トークにご案内します。\n\n' +
      'お手数ですが、この トークに「お名前（フルネーム）」と「ご用件（例：パスワードを忘れた／IDを変更したい）」をお送りください。\n' +
      '担当より順次ご連絡します。');
    try {
      notifyAdminLine_('【ログイン情報の問い合わせ】\nこの userId から「' + text + '」の連絡がありました。\nuserId: ' + userId + '\n本人確認のうえ、手動でご対応ください。');
    } catch (e) {}
    return;
  }
  // それ以外は反応しない（手動チャット運用の邪魔をしない）
  return;
}

/* ---------------- ID確認フロー用ヘルパー ---------------- */

/** ログイン情報の問い合わせトリガー語か */
function mpIsIdTrigger_(text) {
  const n = text.replace(/[\s　]/g, '').toUpperCase();
  return ['ID確認', 'ＩＤ確認', 'パスワード確認', 'ログイン情報', '会員番号確認', 'ID/パスワード確認', 'IDパスワード確認', 'パスワードを忘れた', 'ログインできない'].some(function (x) {
    return x.toUpperCase() === n;
  });
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
