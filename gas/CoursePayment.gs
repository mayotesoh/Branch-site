/**
 * Branch ─ 講座決済（会員 / 非会員で価格を出し分け）
 * ----------------------------------------------------------------------
 * 流れ:
 *   申込フォーム → 会員番号＋氏名で照合 → 価格を決定 → Stripe Checkout
 *   → 支払い完了 → 会員DBの「受講講座」に追加＋参加記録DBに1行
 *   → 既存の自動集計でスコア（スキルアップ講座受講数）に加点
 *
 * 得点は参加記録DB経由で付与する（Attendance.gs の集計に合流）。
 * これにより二重加算が起きず、返金時は記録を消せば得点も戻る。
 *
 * 【セットアップ】スクリプトプロパティに登録:
 *   NOTION_TOKEN        … 既存
 *   STRIPE_SECRET_KEY   … 未設定なら「申込のみ受付（後日決済案内）」で動作
 * ----------------------------------------------------------------------
 */

const CP_MEMBER_DB = 'ca1b82cb-70c3-4995-b15b-362181c387cd';
const CP_COURSE_DB = '9e653e0a-f59e-47eb-b3c1-c9d443339e48';
const CP_APPLY_DB = '3a776a17-0aae-81d6-bd1e-db010c515032';
const CP_ATTEND_DB = '3a776a17-0aae-8123-89ea-dbd65a7295e7';
const CP_VER = '2022-06-28';

function cpToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!t) throw new Error('NOTION_TOKEN が未設定です。');
  return t;
}
function cpStripeKey_() {
  return PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
}

function cpApi_(path, method, payload) {
  const res = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, {
    method: method || 'get',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cpToken_(), 'Notion-Version': CP_VER },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('Notion: ' + (body.message || res.getResponseCode()));
  }
  return body;
}
function cpQuery_(db, filter) {
  const out = [];
  let cursor;
  do {
    const b = cpApi_('databases/' + db + '/query', 'post', {
      page_size: 100, start_cursor: cursor, filter: filter || undefined,
    });
    b.results.forEach(function (r) { out.push(r); });
    cursor = b.has_more ? b.next_cursor : undefined;
  } while (cursor);
  return out;
}
const cpText_ = function (p) {
  return (((p && (p.title || p.rich_text)) || [])).map(function (t) { return t.plain_text; }).join('');
};
function cpNorm_(s) {
  return String(s || '').replace(/[\s　\-ー－]/g, '').toLowerCase();
}
function cpToday_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * 会員番号＋氏名で会員を照合する。
 * @return {Object|null} 会員ページ（一致しなければ null）
 */
function findMember_(memberNo, name) {
  if (!memberNo || !name) return null;
  const members = cpQuery_(CP_MEMBER_DB);
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (cpNorm_(cpText_(m.properties['会員番号'])) !== cpNorm_(memberNo)) continue;
    // 番号が一致したら、氏名または占い師名も一致するか確認（なりすまし防止）
    const okName =
      cpNorm_(cpText_(m.properties['氏名'])) === cpNorm_(name) ||
      cpNorm_(cpText_(m.properties['占い師名'])) === cpNorm_(name);
    if (okName) return m;
    return null; // 番号は合っているが氏名が違う
  }
  return null;
}

/** 講座の価格を返す */
function coursePrice_(coursePage, isMember) {
  const p = coursePage.properties;
  const key = isMember ? '会員価格' : '非会員価格';
  const v = p[key] && typeof p[key].number === 'number' ? p[key].number : null;
  if (!v || v <= 0) throw new Error('この講座の' + key + 'が設定されていません。運営にお問い合わせください。');
  return Math.round(v);
}

/**
 * 講座申込＋決済ページ作成
 * @param {{courseId:string, memberNo:string, name:string, email:string,
 *          completeUrl:string, cancelUrl:string}} data
 */
function handleCourseCheckout(data) {
  const courseId = String(data.courseId || '').trim();
  const name = String(data.name || '').trim();
  const email = String(data.email || '').trim();
  const memberNo = String(data.memberNo || '').trim();
  if (!courseId || !name) throw new Error('講座とお名前は必須です。');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('メールアドレスの形式が正しくありません。');

  const course = cpApi_('pages/' + courseId);
  if (!(course.properties['決済対象'] && course.properties['決済対象'].checkbox)) {
    throw new Error('この講座はオンライン申込の対象外です。');
  }
  const courseName = cpText_(course.properties['講座名']);

  // 会員照合（番号が入力されている場合のみ）
  let member = null;
  if (memberNo) {
    member = findMember_(memberNo, name);
    if (!member) {
      throw new Error('会員番号とお名前が一致しませんでした。ご登録の内容をご確認ください。');
    }
  }
  const isMember = !!member;
  const amount = coursePrice_(course, isMember);

  // 申込レコードを作成（未決済）
  const applyProps = {
    '申込': { title: [{ text: { content: cpToday_() + ' ' + courseName + ' ' + name } }] },
    '講座': { relation: [{ id: courseId }] },
    '申込者名': { rich_text: [{ text: { content: name } }] },
    '区分': { select: { name: isMember ? '会員' : '非会員' } },
    '金額': { number: amount },
    '決済状態': { select: { name: '未決済' } },
    '申込日': { date: { start: cpToday_() } },
  };
  if (email) applyProps['メール'] = { email: email };
  if (member) applyProps['会員'] = { relation: [{ id: member.id }] };
  const apply = cpApi_('pages', 'post', { parent: { database_id: CP_APPLY_DB }, properties: applyProps });

  // Stripe 未設定 → 申込のみ受付
  if (!cpStripeKey_()) {
    return jsonOutput({
      status: 'applied',
      message: 'お申し込みを受け付けました。お支払い方法は担当より追ってご案内します。',
      course: courseName, amount: amount, isMember: isMember,
    });
  }

  const completeUrl = String(data.completeUrl || '');
  const cancelUrl = String(data.cancelUrl || '');
  if (!/^https?:\/\//.test(completeUrl) || !/^https?:\/\//.test(cancelUrl)) {
    throw new Error('戻り先URLが不正です。');
  }

  const payload = {
    mode: 'payment',
    'line_items[0][price_data][currency]': 'jpy',
    'line_items[0][price_data][product_data][name]': courseName + '（' + (isMember ? '会員' : '一般') + '）',
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][quantity]': '1',
    success_url: completeUrl + (completeUrl.indexOf('?') === -1 ? '?' : '&') + 'session_id={CHECKOUT_SESSION_ID}',
    cancel_url: cancelUrl + (cancelUrl.indexOf('?') === -1 ? '?' : '&') + 'canceled=1',
    'metadata[applyId]': apply.id,
  };
  if (email) payload['customer_email'] = email;

  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + cpStripeKey_() },
    payload: payload,
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('決済の開始に失敗しました: ' + (body.error && body.error.message ? body.error.message : ''));
  }
  return jsonOutput({ status: 'checkout', url: body.url });
}

/**
 * 決済完了の確認 → 受講履歴と得点に反映（冪等）
 */
function confirmCourseCheckout(sessionId) {
  if (!sessionId) throw new Error('session_id がありません。');
  if (!cpStripeKey_()) throw new Error('決済が有効化されていません。');

  // 既に反映済みなら何もしない
  const done = cpQuery_(CP_APPLY_DB, { property: '決済ID', rich_text: { equals: sessionId } });
  if (done.length) {
    const p = done[0].properties;
    return jsonOutput({
      status: 'confirmed', already: true,
      summary: { course: cpText_(p['申込']), amount: p['金額'].number },
    });
  }

  const res = UrlFetchApp.fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
    { method: 'get', headers: { Authorization: 'Bearer ' + cpStripeKey_() }, muteHttpExceptions: true }
  );
  const s = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) throw new Error('決済情報の取得に失敗しました。');
  if (s.payment_status !== 'paid') {
    return jsonOutput({ status: 'pending', message: 'お支払いが確認できませんでした。' });
  }

  const applyId = (s.metadata || {}).applyId;
  if (!applyId) throw new Error('申込情報が見つかりません。');
  const apply = cpApi_('pages/' + applyId);
  const ap = apply.properties;
  const courseId = (ap['講座'].relation[0] || {}).id;
  const memberId = (ap['会員'].relation[0] || {}).id;
  const courseName = courseId ? cpText_(cpApi_('pages/' + courseId).properties['講座名']) : '';

  // 申込を支払済みに
  cpApi_('pages/' + applyId, 'patch', {
    properties: {
      '決済状態': { select: { name: '支払済み' } },
      '決済ID': { rich_text: [{ text: { content: sessionId } }] },
    },
  });

  // 会員なら「受講講座」に追加し、参加記録から得点を付与
  if (memberId && courseId) {
    const member = cpApi_('pages/' + memberId);
    const cur = (member.properties['受講講座'].relation || []).map(function (r) { return { id: r.id }; });
    if (!cur.some(function (r) { return r.id === courseId; })) {
      cpApi_('pages/' + memberId, 'patch', {
        properties: { '受講講座': { relation: cur.concat([{ id: courseId }]) } },
      });
    }
    // 参加記録（種別=スキルアップ講座）→ 既存の自動集計でスコアに反映
    cpApi_('pages', 'post', {
      parent: { database_id: CP_ATTEND_DB },
      properties: {
        '記録': { title: [{ text: { content: cpToday_() + ' ' + courseName + '（受講）' } }] },
        '会員': { relation: [{ id: memberId }] },
        '状態': { select: { name: '出席' } },
        '種別': { select: { name: 'スキルアップ講座' } },
        '開催日': { date: { start: cpToday_() } },
        '取込元': { select: { name: 'フォーム' } },
      },
    });
    // 当該四半期のスコアを再集計（Attendance.gs）
    recomputeMemberScore_(memberId, atQuarterOf_(cpToday_()));
  }

  return jsonOutput({
    status: 'confirmed',
    summary: {
      course: courseName,
      amount: ap['金額'].number,
      isMember: !!memberId,
      name: cpText_(ap['申込者名']),
    },
  });
}

/** 【動作確認用】決済対象の講座と価格を一覧表示 */
function testCourseList() {
  const rows = cpQuery_(CP_COURSE_DB, { property: '決済対象', checkbox: { equals: true } });
  rows.forEach(function (r) {
    const p = r.properties;
    console.log(cpText_(p['講座名']) + ' 会員:' + (p['会員価格'].number || '-') + ' 一般:' + (p['非会員価格'].number || '-'));
  });
  console.log('決済対象の講座: ' + rows.length + '件');
}
