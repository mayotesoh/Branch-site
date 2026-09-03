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

  // ここから会員向け「ID確認」対話。1対1トークのみ（グループでは個人情報を出さない）
  const userId = src.userId;
  if (!userId || (src.type && src.type !== 'user')) return;

  const cache = CacheService.getScriptCache();
  const key = 'idflow_' + userId;
  let state = null;
  try { const s = cache.get(key); if (s) state = JSON.parse(s); } catch (e) {}
  const save = function (st) { cache.put(key, JSON.stringify(st), 600); };

  // 中断
  if (/^(やめる|キャンセル|終了|中止)$/.test(text)) {
    if (state) { cache.remove(key); replyText(ev.replyToken, '終了しました。「ID確認」でいつでも再開できます。'); }
    return;
  }

  // 未開始：トリガー語だけに反応（それ以外は手動チャットの邪魔をしない）
  if (!state) {
    if (mpIsIdTrigger_(text)) {
      save({ step: 'await_name' });
      replyText(ev.replyToken,
        'ログイン情報（会員番号・パスワード）の確認をします。\n' +
        'ご登録のお名前（フルネーム）を送ってください。\n' +
        '例：山田太郎（「山田 太郎」のように間にスペースがあってもOK）\n\n' +
        '※やめるときは「やめる」と送ってください。');
    }
    return;
  }

  // 名前入力待ち
  if (state.step === 'await_name') {
    const member = mpLineFindByName_(text);
    if (member === 'MULTI') {
      cache.remove(key);
      replyText(ev.replyToken, '同じお名前の会員が複数登録されています。お手数ですが運営までご連絡ください。');
      return;
    }
    if (!member) {
      save({ step: 'await_name' });
      replyText(ev.replyToken, 'そのお名前の会員が見つかりませんでした。\nフルネームをもう一度送ってください（例：山田太郎）。\n「やめる」で終了します。');
      return;
    }
    const no = cpText_(member.properties['会員番号']);
    const pin = cpText_(member.properties['暗証番号']);
    save({ step: 'menu', memberId: member.id });
    replyText(ev.replyToken,
      '確認できました。\n\n' +
      '▼あなたのログイン情報\n' +
      '会員番号（ID）：' + (no || '(未設定)') + '\n' +
      'パスワード：' + (pin || '(未設定)') + '\n\n' +
      '変更する場合は次を送ってください。\n' +
      '・「ID変更」→ 会員番号を変更\n' +
      '・「パスワード変更」→ パスワードを変更\n' +
      '・「やめる」→ 終了');
    return;
  }

  // メニュー
  if (state.step === 'menu') {
    const n = text.replace(/[\s　]/g, '');
    if (n === 'ID変更' || n === 'ＩＤ変更') {
      save({ step: 'await_newid', memberId: state.memberId });
      replyText(ev.replyToken, '新しい会員番号（ID）を送ってください。\n※他の会員と重複しない任意の文字列。\n「やめる」で終了。');
      return;
    }
    if (n === 'パスワード変更' || n === 'PW変更') {
      save({ step: 'await_newpin', memberId: state.memberId });
      replyText(ev.replyToken, '新しいパスワードを送ってください。\n※4桁の数字（例：1234）。\n「やめる」で終了。');
      return;
    }
    save({ step: 'menu', memberId: state.memberId });
    replyText(ev.replyToken, '次のいずれかを送ってください。\n・「ID変更」\n・「パスワード変更」\n・「やめる」');
    return;
  }

  // 新しいID待ち
  if (state.step === 'await_newid') {
    const newId = text.trim();
    if (newId.length < 2 || newId.length > 30) {
      save(state);
      replyText(ev.replyToken, 'IDは2〜30文字で入力してください。');
      return;
    }
    if (mpLineIdTaken_(newId, state.memberId)) {
      save(state);
      replyText(ev.replyToken, 'そのIDはすでに使われています。別のIDを入力してください。');
      return;
    }
    cpApi_('pages/' + state.memberId, 'patch', { properties: { '会員番号': { rich_text: [{ text: { content: newId } }] } } });
    save({ step: 'menu', memberId: state.memberId });
    replyText(ev.replyToken, 'IDを「' + newId + '」に変更しました。\n\n続けて「パスワード変更」もできます。終わるときは「やめる」。');
    return;
  }

  // 新しいパスワード待ち
  if (state.step === 'await_newpin') {
    const pin = text.trim();
    if (!/^[0-9]{4}$/.test(pin)) {
      save(state);
      replyText(ev.replyToken, 'パスワードは4桁の数字で入力してください（例：1234）。');
      return;
    }
    cpApi_('pages/' + state.memberId, 'patch', { properties: { '暗証番号': { rich_text: [{ text: { content: pin } }] } } });
    save({ step: 'menu', memberId: state.memberId });
    replyText(ev.replyToken, 'パスワードを変更しました。\n\n続けて「ID変更」もできます。終わるときは「やめる」。');
    return;
  }
}

/* ---------------- ID確認フロー用ヘルパー ---------------- */

/** 「ID確認」系トリガー語か */
function mpIsIdTrigger_(text) {
  const n = text.replace(/[\s　]/g, '').toUpperCase();
  return ['ID確認', 'ＩＤ確認', 'パスワード確認', 'ログイン情報', '会員番号確認', 'ID/パスワード確認', 'IDパスワード確認'].some(function (x) {
    return x.toUpperCase() === n;
  });
}

/** 氏名（スペース有無を無視）で会員を1件検索。複数一致は 'MULTI'、無しは null */
function mpLineFindByName_(name) {
  const target = cpNorm_(name);
  if (!target) return null;
  const members = cpQuery_(CP_MEMBER_DB);
  const hits = members.filter(function (m) {
    return cpNorm_(cpText_(m.properties['氏名'])) === target;
  });
  if (hits.length === 0) return null;
  if (hits.length > 1) return 'MULTI';
  return hits[0];
}

/** 会員番号（正規化）が自分以外で使われているか */
function mpLineIdTaken_(newId, selfId) {
  const target = cpNorm_(newId);
  const members = cpQuery_(CP_MEMBER_DB);
  return members.some(function (m) {
    return m.id !== selfId && cpNorm_(cpText_(m.properties['会員番号'])) === target;
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
