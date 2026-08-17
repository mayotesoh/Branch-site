/**
 * Branch ─ LINE Messaging API 対話式予約ボット
 * ----------------------------------------------------------------------
 * リッチメニュー or「予約」送信 → コンテンツ選択 → 希望日時入力 → シート反映
 *
 * 会話の流れ:
 *   1) ユーザーがリッチメニューをタップ（postback: action=reserve）
 *      または「予約」と送信
 *   2) ボットがコンテンツ選択のクイックリプライを表示
 *   3) ユーザーがコンテンツを選ぶ（or 自由入力）
 *   4) ボットが希望日時の入力を促す（例: 2026-07-01 14:00）
 *   5) ユーザーが日時を送信 → スプレッドシートに追記し、完了メッセージを返信
 *
 * 会話状態は ScriptProperties に userId 単位で保存します。
 * ----------------------------------------------------------------------
 */

// チャネルアクセストークン：スクリプトプロパティ LINE_CHANNEL_ACCESS_TOKEN を優先。
// （プロパティに本番トークンを入れておけば、コードは触らなくてよい）
const LINE_CHANNEL_ACCESS_TOKEN =
  PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '';

// 予約できるコンテンツ種別（サイトの CONTENT_TYPES と揃える）
const LINE_CONTENT_TYPES = [
  '体験講座',
  '養成講座',
  '個別セッション',
  '練習会・ロープレ',
  '鑑定',
  'キャリア相談',
  'その他',
];

/**
 * Webhook 本体（Code.gs の doPost から呼ばれる）
 */
function handleLineWebhook(data) {
  data.events.forEach(function (ev) {
    try {
      handleLineEvent(ev);
    } catch (err) {
      console.error('LINE event error: ' + err);
    }
  });
}

function handleLineEvent(ev) {
  // 送信先ID確認コマンド（運営セットアップ用）: 「ID」と送るとこの会話のIDを返す。
  // 1対1なら userId、グループなら groupId を通知先に設定できる。
  if (ev.type === 'message' && ev.message && ev.message.type === 'text' && ev.replyToken) {
    const t = ev.message.text.trim().toUpperCase();
    if (t === 'ID' || t === 'ＩＤ' || t === '通知先') {
      const src = ev.source || {};
      const id = src.groupId || src.roomId || src.userId || '(取得不可)';
      const kind = src.groupId ? 'groupId（グループ）' : src.roomId ? 'roomId（複数トーク）' : 'userId（1対1）';
      replyText(
        ev.replyToken,
        '通知先ID（' + kind + '）:\n' + id +
        '\n\nこの値を Apps Script のスクリプトプロパティ「LINE_ADMIN_TARGET」に設定すると、決済完了時にここへ通知が届きます。'
      );
      return;
    }
  }

  const userId = ev.source && ev.source.userId;
  if (!userId) return;

  // リッチメニュー（postback）/「予約」テキストで開始
  if (ev.type === 'postback' && ev.postback) {
    const params = parseQuery(ev.postback.data);
    if (params.action === 'reserve') {
      startReservation(ev.replyToken, userId);
      return;
    }
    if (params.action === 'content') {
      // コンテンツをpostbackで選択
      setState(userId, { step: 'awaitDate', content: params.value });
      replyText(
        ev.replyToken,
        '「' + params.value + '」ですね。\n\n希望日時を入力してください。\n例）2026-07-01 14:00'
      );
      return;
    }
  }

  if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
    const text = ev.message.text.trim();
    if (text === '予約' || text === '予約する') {
      startReservation(ev.replyToken, userId);
      return;
    }
    handleConversation(ev.replyToken, userId, text);
    return;
  }
}

/**
 * 予約開始：コンテンツ選択のクイックリプライを表示
 */
function startReservation(replyToken, userId) {
  setState(userId, { step: 'awaitContent' });

  const items = LINE_CONTENT_TYPES.map(function (c) {
    return {
      type: 'action',
      action: {
        type: 'postback',
        label: c,
        data: 'action=content&value=' + encodeURIComponent(c),
        displayText: c,
      },
    };
  });

  replyMessage(replyToken, [
    {
      type: 'text',
      text: 'ご予約ありがとうございます。\nご希望のコンテンツを選んでください。',
      quickReply: { items: items },
    },
  ]);
}

/**
 * 会話の続き（状態に応じて処理）
 */
function handleConversation(replyToken, userId, text) {
  const state = getState(userId);

  if (!state || !state.step) {
    // 予約フロー中でない通常メッセージには反応しない（手動チャットの邪魔をしない）
    return;
  }

  // コンテンツを自由入力で指定した場合
  if (state.step === 'awaitContent') {
    setState(userId, { step: 'awaitDate', content: text });
    replyText(
      replyToken,
      '「' + text + '」ですね。\n\n希望日時を入力してください。\n例）2026-07-01 14:00'
    );
    return;
  }

  // 希望日時の入力
  if (state.step === 'awaitDate') {
    const parsed = parseDateTime(text);
    if (!parsed) {
      replyText(
        replyToken,
        '日時を読み取れませんでした。\n例）2026-07-01 14:00 の形式で入力してください。'
      );
      return;
    }

    const userName = getLineDisplayName(userId);
    appendReservation({
      userName: userName,
      userId: userId,
      email: '', // LINE予約ではメール未取得
      date: parsed.date,
      time: parsed.time,
      content: state.content || '',
    });
    clearState(userId);

    replyText(
      replyToken,
      '予約を受け付けました。\n\n' +
        'コンテンツ：' + (state.content || '') + '\n' +
        '日時：' + parsed.date + (parsed.time ? ' ' + parsed.time : '') + '\n\n' +
        'ありがとうございます。'
    );
    return;
  }
}

/* ---------------- 日時パース ---------------- */

// "2026-07-01 14:00" / "2026/07/01 14:00" / "2026-07-01" などに対応
function parseDateTime(text) {
  const t = text.replace(/[年月／.]/g, '-').replace(/日/g, '').replace(/\//g, '-').trim();
  const m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ Tt]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const date = m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  const time = (m[4] != null) ? pad2(m[4]) + ':' + m[5] : '';
  return { date: date, time: time };
}

function pad2(n) {
  return ('0' + String(n)).slice(-2);
}

function parseQuery(q) {
  const o = {};
  (q || '').split('&').forEach(function (kv) {
    const p = kv.split('=');
    o[p[0]] = decodeURIComponent(p[1] || '');
  });
  return o;
}

/* ---------------- 会話状態（ScriptProperties） ---------------- */

function stateKey(userId) {
  return 'state_' + userId;
}
function getState(userId) {
  const v = PropertiesService.getScriptProperties().getProperty(stateKey(userId));
  return v ? JSON.parse(v) : null;
}
function setState(userId, obj) {
  PropertiesService.getScriptProperties().setProperty(stateKey(userId), JSON.stringify(obj));
}
function clearState(userId) {
  PropertiesService.getScriptProperties().deleteProperty(stateKey(userId));
}

/* ---------------- LINE API 呼び出し ---------------- */

function replyText(replyToken, text) {
  replyMessage(replyToken, [{ type: 'text', text: text }]);
}

function replyMessage(replyToken, messages) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + lineToken_() },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true,
  });
}

function getLineDisplayName(userId) {
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + userId, {
      headers: { Authorization: 'Bearer ' + lineToken_() },
      muteHttpExceptions: true,
    });
    const p = JSON.parse(res.getContentText());
    return p.displayName || '';
  } catch (e) {
    return '';
  }
}

/* ---------------- 運営向けプッシュ通知 ---------------- */

/**
 * チャネルアクセストークン。スクリプトプロパティ優先、無ければ定数。
 * （リポジトリの定数はプレースホルダのため、実運用はプロパティ推奨）
 */
function lineToken_() {
  const p = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  return p || LINE_CHANNEL_ACCESS_TOKEN;
}

/**
 * 指定の宛先（userId または groupId）へテキストをプッシュ送信。
 * @param {string} to 宛先ID
 * @param {string} text 本文
 */
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
 * 運営（公式LINE）へ通知する。宛先はスクリプトプロパティ LINE_ADMIN_TARGET。
 * 複数宛先はカンマ区切りで指定可。未設定・失敗しても本処理は止めない。
 * @param {string} text 通知本文
 */
function notifyAdminLine_(text) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('LINE_ADMIN_TARGET');
    if (!raw) {
      console.warn('LINE_ADMIN_TARGET 未設定のため運営通知をスキップ');
      return;
    }
    raw.split(',').map(function (s) { return s.trim(); }).filter(String).forEach(function (to) {
      pushLineText_(to, text);
    });
  } catch (e) {
    console.error('運営LINE通知エラー: ' + e);
  }
}
