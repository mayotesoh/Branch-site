/**
 * Fortune Lab☆！ ─ 対面決済（現場でQRを表示、お客様のスマホでカード決済）
 * ----------------------------------------------------------------------
 * 流れ:
 *   スタッフ /pay で品目・金額入力 → offline_create でレコード作成
 *   → QRは /pay/card?rid=<レコードID> を指す
 *   → お客様がスマホで開く → 金額確認 → カード入力（pay.js）→ offline_charge
 *   → PAY.JPで課金 → レコードを支払済みに → スタッフ画面が offline_status で検知
 *
 * 【セットアップ】スクリプトプロパティ:
 *   NOTION_TOKEN / PAYJP_SECRET_KEY（Payjp.gs 参照）
 * ----------------------------------------------------------------------
 */

const OP_DB = '3a776a17-0aae-810a-842f-dbde06f5058c'; // 対面決済DB
const OP_VER = '2022-06-28';

// 金額の安全範囲（誤入力による高額決済を防ぐ）
const OP_MIN_AMOUNT = 100;
const OP_MAX_AMOUNT = 300000;

function opToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!t) throw new Error('NOTION_TOKEN が未設定です。');
  return t;
}
function opApi_(path, method, payload) {
  const res = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, {
    method: method || 'get',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + opToken_(), 'Notion-Version': OP_VER },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('Notion: ' + (body.message || res.getResponseCode()));
  }
  return body;
}
const opText_ = function (p) {
  return (((p && (p.title || p.rich_text)) || [])).map(function (t) { return t.plain_text; }).join('');
};

/**
 * 対面決済レコードを作成（未決済）。QRにするレコードIDを返す。
 * @param {{item:string, amount:number, staff:string, memo:string}} data
 */
function handleOfflineCreate(data) {
  const item = String(data.item || '').trim();
  const amount = Math.round(Number(data.amount));
  const staff = String(data.staff || '').trim();
  const memo = String(data.memo || '').trim();

  if (!item) throw new Error('品目を入力してください。');
  if (!amount || isNaN(amount)) throw new Error('金額を正しく入力してください。');
  if (amount < OP_MIN_AMOUNT || amount > OP_MAX_AMOUNT) {
    throw new Error('金額は ' + OP_MIN_AMOUNT + '円〜' + OP_MAX_AMOUNT + '円の範囲で入力してください。');
  }
  if (!isPayjpEnabled_()) {
    throw new Error('決済がまだ有効化されていません（PAYJP_SECRET_KEY 未設定）。');
  }

  const props = {
    '品目': { title: [{ text: { content: item } }] },
    '金額': { number: amount },
    '決済状態': { select: { name: '未決済' } },
    '日時': { date: { start: Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX") } },
  };
  if (staff) props['担当'] = { rich_text: [{ text: { content: staff } }] };
  if (memo) props['メモ'] = { rich_text: [{ text: { content: memo } }] };
  const rec = opApi_('pages', 'post', { parent: { database_id: OP_DB }, properties: props });

  return jsonOutput({ status: 'created', rid: rec.id, item: item, amount: amount });
}

/** お客様のカードページ用：レコードの品目・金額・状態を返す */
function getOfflineInfo(rid) {
  if (!rid) throw new Error('rid がありません。');
  const rec = opApi_('pages/' + rid);
  const p = rec.properties;
  return jsonOutput({
    status: 'ok',
    item: opText_(p['品目']),
    amount: (p['金額'] && p['金額'].number) || 0,
    paid: !!(p['決済状態'] && p['決済状態'].select && p['決済状態'].select.name === '支払済み'),
  });
}

/**
 * お客様のカード決済（offline_charge）
 * @param {{rid:string, token:string}} data
 */
function handleOfflineCharge(data) {
  const rid = String(data.rid || '').trim();
  const token = String(data.token || '').trim();
  if (!rid) throw new Error('rid がありません。');
  if (!token) throw new Error('カード情報が確認できませんでした。');

  const rec = opApi_('pages/' + rid);
  const p = rec.properties;
  const cur = p['決済状態'] && p['決済状態'].select && p['決済状態'].select.name;
  if (cur === '支払済み') return jsonOutput({ status: 'paid' }); // 冪等

  const item = opText_(p['品目']);
  const amount = (p['金額'] && p['金額'].number) || 0;
  if (!amount) throw new Error('金額が不正です。');

  const charge = payjpCharge_(token, amount, item, { rid: rid, kind: 'offline' });

  opApi_('pages/' + rid, 'patch', {
    properties: {
      '決済状態': { select: { name: '支払済み' } },
      '決済ID': { rich_text: [{ text: { content: charge.id } }] },
    },
  });

  // 運営（公式LINE）へ通知
  notifyAdminLine_(
    '💳 対面決済 完了\n━━━━━━━━━━\n品目：' + item + '\n金額：¥' + Number(amount).toLocaleString() +
    '\n決済ID：' + charge.id
  );

  return jsonOutput({ status: 'paid' });
}

/** スタッフ画面のポーリング用：入金状況 */
function checkOfflineStatus(rid) {
  if (!rid) throw new Error('rid がありません。');
  const rec = opApi_('pages/' + rid);
  const st = rec.properties['決済状態'] && rec.properties['決済状態'].select && rec.properties['決済状態'].select.name;
  return jsonOutput({ status: st === '支払済み' ? 'paid' : 'pending' });
}
