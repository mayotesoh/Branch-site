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

// LINE Developers → Messaging API → チャネルアクセストークン（長期）を貼り付け
const LINE_CHANNEL_ACCESS_TOKEN = 'ここにチャネルアクセストークンを設定';

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
    replyText(replyToken, 'ご予約は「予約」と送るか、メニューの予約ボタンから始めてください。');
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
    headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true,
  });
}

function getLineDisplayName(userId) {
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + userId, {
      headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
      muteHttpExceptions: true,
    });
    const p = JSON.parse(res.getContentText());
    return p.displayName || '';
  } catch (e) {
    return '';
  }
}
