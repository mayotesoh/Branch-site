/**
 * Fortune Labo ─ 会員ページ（ID照会ログイン → スコア・評定を返す）
 * ----------------------------------------------------------------------
 * 会員番号 ＋ 暗証番号（4桁）で会員DBを照合し、本人のスコア/評定を返す。
 * 認証は簡易（ID照会方式）。将来的に LINE ログインへ差し替え可能。
 *
 * 依存：CoursePayment.gs の cpApi_/cpQuery_/cpText_/cpNorm_ と CP_MEMBER_DB、
 *       Code.gs の jsonOutput。
 * ----------------------------------------------------------------------
 */

/** ロールアップ値を数値で取り出す（number型 / array合計 の両対応） */
function mpRollupNumber_(prop) {
  if (!prop || prop.type !== 'rollup' || !prop.rollup) return null;
  const r = prop.rollup;
  if (typeof r.number === 'number') return r.number;
  if (Array.isArray(r.array)) {
    let sum = 0, found = false;
    r.array.forEach(function (it) {
      if (it && typeof it.number === 'number') { sum += it.number; found = true; }
    });
    return found ? sum : null;
  }
  return null;
}

/**
 * 会員ログイン（member_login）
 * @param {{memberNo:string, pin:string}} data
 */
function handleMemberLogin(data) {
  const no = String(data.memberNo || '').trim();
  const pin = String(data.pin || '').trim();
  if (!no || !pin) throw new Error('会員番号と暗証番号を入力してください。');

  const members = cpQuery_(CP_MEMBER_DB);
  let hit = null;
  for (let i = 0; i < members.length; i++) {
    if (cpNorm_(cpText_(members[i].properties['会員番号'])) === cpNorm_(no)) { hit = members[i]; break; }
  }
  // 会員番号・暗証番号のどちらが違うかは明かさない（総当たり対策）
  const ngMsg = '会員番号または暗証番号が正しくありません。';
  if (!hit) throw new Error(ngMsg);

  const savedPin = cpText_(hit.properties['暗証番号']).trim();
  if (!savedPin) throw new Error('この会員には暗証番号が未設定です。運営にお問い合わせください。');
  if (savedPin !== pin) throw new Error(ngMsg);

  const p = hit.properties;
  const multi = function (key) {
    return (p[key] && p[key].multi_select ? p[key].multi_select : []).map(function (o) { return o.name; });
  };
  const sel = function (key) {
    return p[key] && p[key].select ? p[key].select.name : '';
  };

  // 受講講座（リレーション）→ 講座名
  const courseIds = (p['受講講座'] && p['受講講座'].relation ? p['受講講座'].relation : []).map(function (r) { return r.id; });
  const courses = courseIds.map(function (id) {
    try { return cpText_(cpApi_('pages/' + id).properties['講座名']); } catch (e) { return null; }
  }).filter(Boolean);

  return jsonOutput({
    status: 'ok',
    name: cpText_(p['氏名']),
    tellerName: cpText_(p['占い師名']),
    memberNo: cpText_(p['会員番号']),
    memberStatus: sel('会員ステータス'),
    thisTerm: mpRollupNumber_(p['今期得点']),
    total: mpRollupNumber_(p['通算得点']),
    titles: multi('称号'),
    certs: multi('認定/テスト'),
    courses: courses,
  });
}

/** 【動作確認用】会員番号＋暗証番号でログインを試す */
function testMemberLogin() {
  const out = handleMemberLogin({ memberNo: 'BR-001', pin: '0000' });
  console.log(out.getContent());
}
