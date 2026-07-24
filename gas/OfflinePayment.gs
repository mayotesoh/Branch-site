/**
 * Branch ─ 対面決済（現場でQRを表示して決済）
 * ----------------------------------------------------------------------
 * 使い方（スタッフ）:
 *   サイトの /pay を開く → 品目と金額を入力 → QRが表示される
 *   → お客様がスマホで読み取って決済 → スタッフ画面に「支払い完了」が出る
 *
 * 仕組み:
 *   金額入力 → Stripe Checkout セッション作成 → そのURLをQR化
 *   → 数秒おきに入金確認をポーリング → 完了したら対面決済DBを支払済みに更新
 *
 * 【セットアップ】スクリプトプロパティ:
 *   NOTION_TOKEN / STRIPE_SECRET_KEY
 *   STRIPE_SECRET_KEY 未設定の場合はエラーメッセージを返します。
 * ----------------------------------------------------------------------
 */

const OP_DB = '3a776a17-0aae-810a-842f-dbde06f5058c'; // Branch 対面決済DB
const OP_VER = '2022-06-28';

// 金額の安全範囲（誤入力による高額決済を防ぐ）
const OP_MIN_AMOUNT = 100;
const OP_MAX_AMOUNT = 300000;

function opToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!t) throw new Error('NOTION_TOKEN が未設定です。');
  return t;
}
function opStripeKey_() {
  return PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
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

/**
 * 対面決済を開始し、QRにするURLを返す
 * @param {{item:string, amount:number, staff:string, memo:string}} data
 */
function handleOfflineCheckout(data) {
  const item = String(data.item || '').trim();
  const amount = Math.round(Number(data.amount));
  const staff = String(data.staff || '').trim();
  const memo = String(data.memo || '').trim();

  if (!item) throw new Error('品目を入力してください。');
  if (!amount || isNaN(amount)) throw new Error('金額を正しく入力してください。');
  if (amount < OP_MIN_AMOUNT || amount > OP_MAX_AMOUNT) {
    throw new Error('金額は ' + OP_MIN_AMOUNT + '円〜' + OP_MAX_AMOUNT + '円の範囲で入力してください。');
  }
  if (!opStripeKey_()) {
    throw new Error('決済がまだ有効化されていません（STRIPE_SECRET_KEY 未設定）。');
  }

  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  // 記録を先に作成（未決済）
  const props = {
    '品目': { title: [{ text: { content: item } }] },
    '金額': { number: amount },
    '決済状態': { select: { name: '未決済' } },
    '日時': { date: { start: Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX") } },
  };
  if (staff) props['担当'] = { rich_text: [{ text: { content: staff } }] };
  if (memo) props['メモ'] = { rich_text: [{ text: { content: memo } }] };
  const rec = opApi_('pages', 'post', { parent: { database_id: OP_DB }, properties: props });

  const payload = {
    mode: 'payment',
    'line_items[0][price_data][currency]': 'jpy',
    'line_items[0][price_data][product_data][name]': item,
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][quantity]': '1',
    // 対面なので戻り先は簡易（お客様のスマホに表示される）
    success_url: 'https://mayotesoh.github.io/Branch-site/pay/thanks/',
    cancel_url: 'https://mayotesoh.github.io/Branch-site/pay/',
    expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
    'metadata[recordId]': rec.id,
    'metadata[kind]': 'offline',
  };

  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + opStripeKey_() },
    payload: payload,
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('決済の開始に失敗しました: ' + (body.error && body.error.message ? body.error.message : ''));
  }
  // セッションIDを記録（照合用）
  opApi_('pages/' + rec.id, 'patch', {
    properties: { '決済ID': { rich_text: [{ text: { content: body.id } }] } },
  });

  return jsonOutput({
    status: 'created',
    url: body.url,
    sessionId: body.id,
    item: item,
    amount: amount,
    at: now,
  });
}

/**
 * 入金状況の確認（スタッフ画面がポーリングする）
 * 支払い済みなら対面決済DBを「支払済み」に更新する。
 */
function checkOfflineStatus(sessionId) {
  if (!sessionId) throw new Error('session_id がありません。');
  if (!opStripeKey_()) throw new Error('決済が有効化されていません。');

  const res = UrlFetchApp.fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
    { method: 'get', headers: { Authorization: 'Bearer ' + opStripeKey_() }, muteHttpExceptions: true }
  );
  const s = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('決済情報の取得に失敗しました。');
  }

  if (s.payment_status === 'paid') {
    const recordId = (s.metadata || {}).recordId;
    if (recordId) {
      const rec = opApi_('pages/' + recordId);
      const cur = rec.properties['決済状態'] && rec.properties['決済状態'].select;
      if (!cur || cur.name !== '支払済み') {
        opApi_('pages/' + recordId, 'patch', {
          properties: { '決済状態': { select: { name: '支払済み' } } },
        });
      }
    }
    return jsonOutput({ status: 'paid' });
  }
  return jsonOutput({ status: s.status === 'expired' ? 'expired' : 'pending' });
}
