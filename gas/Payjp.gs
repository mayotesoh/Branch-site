/**
 * Fortune Lab☆！ ─ PAY.JP 決済 共通ヘルパー
 * ----------------------------------------------------------------------
 * 講座決済（CoursePayment.gs）と対面決済（OfflinePayment.gs）から使う。
 * 【セットアップ】スクリプトプロパティに登録:
 *   PAYJP_SECRET_KEY = sk_test_xxx / sk_live_xxx
 * ----------------------------------------------------------------------
 */

function getPayjpKey_() {
  return PropertiesService.getScriptProperties().getProperty('PAYJP_SECRET_KEY');
}
function isPayjpEnabled_() {
  return !!getPayjpKey_();
}

/**
 * PAY.JP でカードトークンを課金する。
 * @param {string} token pay.js のトークンID
 * @param {number} amount 金額（円）
 * @param {string} description 摘要
 * @param {Object} metadata 付帯情報（任意）
 * @return {{paid:boolean, id:string}}
 */
function payjpCharge_(token, amount, description, metadata) {
  const key = getPayjpKey_();
  if (!key) throw new Error('決済が有効化されていません（PAYJP_SECRET_KEY 未設定）。');
  if (!token) throw new Error('カード情報が確認できませんでした。');

  const payload = { amount: String(amount), currency: 'jpy', card: token };
  if (description) payload['description'] = description;
  if (metadata) {
    Object.keys(metadata).forEach(function (k) {
      if (metadata[k] != null && metadata[k] !== '') {
        payload['metadata[' + k + ']'] = String(metadata[k]).slice(0, 200);
      }
    });
  }

  const res = UrlFetchApp.fetch('https://api.pay.jp/v1/charges', {
    method: 'post',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(key + ':') },
    payload: payload,
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error(body && body.error ? body.error.message : '決済に失敗しました。');
  }
  if (!body.paid) throw new Error('お支払いが承認されませんでした。');
  return { paid: true, id: body.id };
}
