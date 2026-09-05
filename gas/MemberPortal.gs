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
// お題回答DB（今週の題材への読み解き投稿）
const MP_ANSWER_DB = '3d276a17-0aae-81c2-8f3a-cf6a1b4f0eb8';
// モニター応募DB
const MP_MONITOR_DB = '3d276a17-0aae-8151-9fb1-cf73d0219950';

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
        eventId: evRel.length ? evRel[0].id : '',
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
 * 会員番号＋暗証番号で会員を照合して会員ページを返す（不一致は例外）。
 * ログイン／予約／出席確認で共通利用。
 */
function mpFindMember_(no, pin) {
  const n = String(no || '').trim();
  const p = String(pin || '').trim();
  if (!n || !p) throw new Error('会員番号と暗証番号を入力してください。');

  const members = cpQuery_(CP_MEMBER_DB);
  let hit = null;
  for (let i = 0; i < members.length; i++) {
    if (cpNorm_(cpText_(members[i].properties['会員番号'])) === cpNorm_(n)) { hit = members[i]; break; }
  }
  // 会員番号・暗証番号のどちらが違うかは明かさない（総当たり対策）
  const ngMsg = '会員番号または暗証番号が正しくありません。';
  if (!hit) throw new Error(ngMsg);

  const savedPin = cpText_(hit.properties['暗証番号']).trim();
  if (!savedPin) throw new Error('この会員には暗証番号が未設定です。運営にお問い合わせください。');
  if (savedPin !== p) throw new Error(ngMsg);
  return hit;
}

/** 同一会員×同一イベントの参加記録を1件返す（無ければ null） */
function mpFindPart_(memberId, eventId) {
  const b = cpApi_('databases/' + MP_PART_DB + '/query', 'post', {
    page_size: 1,
    filter: {
      and: [
        { property: '会員', relation: { contains: memberId } },
        { property: 'イベント', relation: { contains: eventId } },
      ],
    },
  });
  return (b.results && b.results.length) ? b.results[0] : null;
}

/** イベントページから基本情報を取り出す */
function mpEventInfo_(eventId) {
  const ev = cpApi_('pages/' + eventId);
  const ep = ev.properties;
  return {
    page: ev,
    name: cpText_(ep['イベント名']),
    type: (ep['種別'] && ep['種別'].select) ? ep['種別'].select.name : '',
    date: (ep['開催日'] && ep['開催日'].date) ? ep['開催日'].date.start : '',
    secret: cpText_(ep['合言葉']).trim(),
  };
}

/** 参加記録を1件作成する（状態＝申込 or 出席） */
function mpCreatePart_(memberId, ev, status) {
  const props = {
    '記録': { title: [{ text: { content: ev.name || 'イベント' } }] },
    '会員': { relation: [{ id: memberId }] },
    'イベント': { relation: [{ id: ev.pageId }] },
    '状態': { select: { name: status } },
    '取込元': { select: { name: '会員ページ' } },
  };
  if (ev.type) props['種別'] = { select: { name: ev.type } };
  if (ev.date) props['開催日'] = { date: { start: ev.date } };
  cpApi_('pages', 'post', { parent: { database_id: MP_PART_DB }, properties: props });
}

/**
 * イベント予約（event_reserve）：参加記録に「申込」を作成
 * @param {{memberNo:string, pin:string, eventId:string}} data
 */
function handleEventReserve(data) {
  const eventId = String(data.eventId || '').trim();
  if (!eventId) throw new Error('イベントが指定されていません。');
  const hit = mpFindMember_(data.memberNo, data.pin);
  const info = mpEventInfo_(eventId);
  info.pageId = eventId;

  const existing = mpFindPart_(hit.id, eventId);
  if (existing) {
    const st = (existing.properties['状態'] && existing.properties['状態'].select)
      ? existing.properties['状態'].select.name : '';
    return jsonOutput({ status: 'ok', reserved: true, already: true, state: st, event: info.name });
  }
  mpCreatePart_(hit.id, info, '申込');
  return jsonOutput({ status: 'ok', reserved: true, state: '申込', event: info.name });
}

/**
 * 予約キャンセル（event_cancel）：申込の参加記録を削除（アーカイブ）
 * ※すでに出席済みのものはキャンセル不可
 * @param {{memberNo:string, pin:string, eventId:string}} data
 */
function handleEventCancel(data) {
  const eventId = String(data.eventId || '').trim();
  if (!eventId) throw new Error('イベントが指定されていません。');
  const hit = mpFindMember_(data.memberNo, data.pin);
  const existing = mpFindPart_(hit.id, eventId);
  if (!existing) throw new Error('この予約は見つかりませんでした。');
  const st = (existing.properties['状態'] && existing.properties['状態'].select)
    ? existing.properties['状態'].select.name : '';
  if (st === '出席') throw new Error('すでに出席済みのため取り消せません。');
  cpApi_('pages/' + existing.id, 'patch', { archived: true });
  return jsonOutput({ status: 'ok', cancelled: true });
}

/**
 * 出席確認（event_checkin）：合言葉を照合し参加記録を「出席」に
 * @param {{memberNo:string, pin:string, eventId:string, code:string}} data
 */
function handleEventCheckin(data) {
  const eventId = String(data.eventId || '').trim();
  const code = String(data.code || '').trim();
  if (!eventId) throw new Error('イベントが指定されていません。');
  if (!code) throw new Error('合言葉を入力してください。');
  const hit = mpFindMember_(data.memberNo, data.pin);
  const info = mpEventInfo_(eventId);
  info.pageId = eventId;
  if (!info.secret) throw new Error('このイベントはまだ合言葉が設定されていません。');
  if (cpNorm_(info.secret) !== cpNorm_(code)) throw new Error('合言葉が正しくありません。');

  const existing = mpFindPart_(hit.id, eventId);
  if (existing) {
    cpApi_('pages/' + existing.id, 'patch', { properties: { '状態': { select: { name: '出席' } } } });
  } else {
    mpCreatePart_(hit.id, info, '出席');
  }
  return jsonOutput({ status: 'ok', attended: true, event: info.name });
}

/**
 * 今週の題材への読み解き投稿（submit_reading）
 * @param {{memberNo:string, pin:string, themeId:string, content:string, penName:string, publicOk:boolean}} data
 */
function handleSubmitReading(data) {
  const themeId = String(data.themeId || '').trim();
  const content = String(data.content || '').trim();
  if (!themeId) throw new Error('お題が指定されていません。');
  if (!content) throw new Error('読み解きを入力してください。');
  const hit = mpFindMember_(data.memberNo, data.pin);
  const pen = String(data.penName || '').trim()
    || cpText_(hit.properties['占い師名'])
    || cpText_(hit.properties['氏名'])
    || '匿名';
  cpApi_('pages', 'post', {
    parent: { database_id: MP_ANSWER_DB },
    properties: {
      '回答': { title: [{ text: { content: pen + 'の読み解き' } }] },
      'お題': { relation: [{ id: themeId }] },
      '会員': { relation: [{ id: hit.id }] },
      'ペンネーム': { rich_text: [{ text: { content: pen.slice(0, 200) } }] },
      '鑑定内容': { rich_text: [{ text: { content: content.slice(0, 1900) } }] },
      '公開可': { checkbox: !!data.publicOk },
      '投稿日': { date: { start: cpToday_() } },
    },
  });
  return jsonOutput({ status: 'ok' });
}

/**
 * 無料鑑定モニター応募（monitor_apply）※会員でなくても応募可
 * @param {{penName,birth,worry,gender,age,pref,birthtime,consent}} data
 */
function handleMonitorApply(data) {
  const pen = String(data.penName || '').trim();
  const birth = String(data.birth || '').trim();
  const worry = String(data.worry || '').trim();
  if (!pen || !birth || !worry) throw new Error('必須項目を入力してください。');
  if (!data.consent) throw new Error('公開への同意が必要です。');
  const rt = function (s) { return { rich_text: [{ text: { content: String(s || '').slice(0, 1900) } }] }; };
  const props = {
    '応募': { title: [{ text: { content: pen.slice(0, 200) } }] },
    'ペンネーム': rt(pen), '生年月日': rt(birth), '悩み・背景': rt(worry),
    '都道府県': rt(data.pref), '年齢': rt(data.age), '出生時間': rt(data.birthtime),
    '全公開に同意': { checkbox: true },
    '応募日': { date: { start: cpToday_() } },
    'ステータス': { select: { name: '応募' } },
  };
  if (data.gender) props['性別'] = { select: { name: String(data.gender) } };
  cpApi_('pages', 'post', { parent: { database_id: MP_MONITOR_DB }, properties: props });
  try { notifyAdminLine_('【モニター応募】' + pen + '（' + birth + '）\n' + worry.slice(0, 120)); } catch (e) {}
  return jsonOutput({ status: 'ok' });
}

/**
 * 会員ログイン（member_login）
 * @param {{memberNo:string, pin:string}} data
 */
function handleMemberLogin(data) {
  const no = String(data.memberNo || '').trim();
  const hit = mpFindMember_(no, data.pin);
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
    coupon: (p['クーポン残高'] && typeof p['クーポン残高'].number === 'number') ? p['クーポン残高'].number : 0,
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
