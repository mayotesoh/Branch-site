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

// 鑑定ロープレ評価DB（会員番号で照合・最新1件を返す）
const MP_EVAL_DB = '3cc76a17-0aae-81aa-a916-f611abe889b2';
const MP_EVAL_ITEMS = ['声・話し方', '聞く姿勢', '言葉選び', '鑑定の流れ', '鑑定内容', '安心感'];

// 参加記録DB（会員の定例会・セミナー等の参加履歴＝スタンプ）
const MP_PART_DB = '3a776a17-0aae-8123-89ea-dbd65a7295e7';

/** その会員の参加記録（新しい順）。イベント名は関連ページから取得 */
function mpStamps_(memberPageId) {
  try {
    const body = cpApi_('databases/' + MP_PART_DB + '/query', 'post', {
      page_size: 100,
      filter: { property: '会員', relation: { contains: memberPageId } },
      sorts: [{ property: '開催日', direction: 'descending' }],
    });
    return (body.results || []).map(function (r) {
      const p = r.properties;
      let evName = '';
      const evRel = (p['イベント'] && p['イベント'].relation) ? p['イベント'].relation : [];
      if (evRel.length) {
        try { evName = cpText_(cpApi_('pages/' + evRel[0].id).properties['イベント名']); } catch (e) {}
      }
      return {
        event: evName || cpText_(p['記録']),
        type: (p['種別'] && p['種別'].select) ? p['種別'].select.name : '',
        date: (p['開催日'] && p['開催日'].date) ? p['開催日'].date.start : '',
        status: (p['状態'] && p['状態'].select) ? p['状態'].select.name : '',
      };
    });
  } catch (e) {
    return [];
  }
}

/** その会員の最新評価を1件返す（無ければ null） */
function mpLatestEval_(memberNo) {
  try {
    const body = cpApi_('databases/' + MP_EVAL_DB + '/query', 'post', {
      page_size: 1,
      filter: { property: '会員番号', rich_text: { equals: memberNo } },
      sorts: [{ property: '評価日', direction: 'descending' }],
    });
    if (!body.results || !body.results.length) return null;
    const p = body.results[0].properties;
    const num = function (k) { return (p[k] && typeof p[k].number === 'number') ? p[k].number : null; };
    const scores = {};
    MP_EVAL_ITEMS.forEach(function (k) { scores[k] = num(k); });
    return {
      date: (p['評価日'] && p['評価日'].date) ? p['評価日'].date.start : '',
      evaluator: cpText_(p['評価者']),
      scores: scores,
      comment: cpText_(p['総合コメント']),
    };
  } catch (e) {
    return null;
  }
}

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
    arts: multi('占術'),
    titles: multi('称号'),
    certs: multi('認定/テスト'),
    courses: courses,
    stamps: mpStamps_(hit.id),
    evaluation: mpLatestEval_(cpText_(p['会員番号']) || no),
  });
}

/** 【動作確認用】会員番号＋暗証番号でログインを試す */
function testMemberLogin() {
  const out = handleMemberLogin({ memberNo: 'BR-001', pin: '0000' });
  console.log(out.getContent());
}
