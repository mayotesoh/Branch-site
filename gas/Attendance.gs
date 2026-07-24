/**
 * Branch ─ 出席受付（QR・合言葉）とスコア自動集計
 * ----------------------------------------------------------------------
 * 流れ:
 *   サイトの出席フォーム（/checkin）→ 合言葉を検証 → 参加記録DBに1行作成
 *   → その会員の今期スコアを「参加記録から再計算」して書き込む
 *
 * 設計の要点:
 *   スコア欄に直接 +1 しない。常に参加記録から再計算するので、
 *   二重送信しても増えず、記録を消せばスコアも自動で戻る（冪等）。
 *
 * 【セットアップ】スクリプトプロパティに NOTION_TOKEN を登録し、
 *   イベントDB / 参加記録DB / 会員DB / スコアDB をインテグレーションに接続。
 * ----------------------------------------------------------------------
 */

const AT_MEMBER_DB = 'ca1b82cb-70c3-4995-b15b-362181c387cd';
const AT_SCORE_DB = '3a776a17-0aae-80f5-9243-cab17a49a0d2';
const AT_EVENT_DB = '3a776a17-0aae-814d-8066-e4c4161e9961';
const AT_ATTEND_DB = '3a776a17-0aae-8123-89ea-dbd65a7295e7';
const AT_NOTION_VER = '2022-06-28';

/** 種別 → スコアDBの項目名（カウント系） */
const KIND_TO_FIELD = {
  '定例会': '定例会参加数',
  'スキルアップ講座': 'スキルアップ講座受講数',
  'リーディング会': 'リーディング会参加数',
  'ロープレ': 'ロープレ参加数',
  'マルシェ・イベント': 'マルシェやイベント参加数',
};
/** 出席率で集計する種別 */
const RATE_KIND = 'zoom解放日';
const RATE_FIELD = 'zoom解放日の出席率';

function atToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!t) throw new Error('NOTION_TOKEN が未設定です。');
  return t;
}

function atApi_(path, method, payload) {
  const res = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, {
    method: method || 'get',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + atToken_(), 'Notion-Version': AT_NOTION_VER },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('Notion: ' + (body.message || res.getResponseCode()));
  }
  return body;
}

function atQueryAll_(db, filter) {
  const out = [];
  let cursor;
  do {
    const b = atApi_('databases/' + db + '/query', 'post', {
      page_size: 100, start_cursor: cursor, filter: filter || undefined,
    });
    b.results.forEach(function (r) { out.push(r); });
    cursor = b.has_more ? b.next_cursor : undefined;
  } while (cursor);
  return out;
}

const atText_ = function (p) {
  return (((p && (p.title || p.rich_text)) || [])).map(function (t) { return t.plain_text; }).join('');
};
/** 表記ゆれを吸収（空白・全角半角） */
function atNorm_(s) {
  return String(s || '').replace(/[\s　]/g, '').toLowerCase();
}

/** 日付(YYYY-MM-DD) → 四半期 "YYYY-Qn" */
function atQuarterOf_(dateStr) {
  const y = Number(String(dateStr).slice(0, 4));
  const m = Number(String(dateStr).slice(5, 7));
  return y + '-Q' + (Math.floor((m - 1) / 3) + 1);
}

function atTodayJst_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

// ────────────────────────────────────────────────────────────
// 出席受付（サイトの /checkin から呼ばれる）
// ────────────────────────────────────────────────────────────

/**
 * @param {{code:string, name:string}} data 合言葉と氏名
 * @return {TextOutput}
 */
function handleCheckin(data) {
  const code = String(data.code || '').trim();
  const name = String(data.name || '').trim();
  if (!code || !name) throw new Error('合言葉とお名前を入力してください。');

  // 1) 合言葉から受付中のイベントを特定
  const events = atQueryAll_(AT_EVENT_DB, { property: '受付中', checkbox: { equals: true } });
  const ev = events.filter(function (e) {
    return atNorm_(atText_(e.properties['合言葉'])) === atNorm_(code);
  })[0];
  if (!ev) throw new Error('合言葉が違うか、受付が終了しています。主催者にご確認ください。');

  const evName = atText_(ev.properties['イベント名']);
  const kind = (ev.properties['種別'] && ev.properties['種別'].select && ev.properties['種別'].select.name) || '';
  const held = (ev.properties['開催日'] && ev.properties['開催日'].date && ev.properties['開催日'].date.start) || atTodayJst_();

  // 2) 氏名から会員を特定（氏名 or 占い師名で照合）
  const members = atQueryAll_(AT_MEMBER_DB);
  const me = members.filter(function (m) {
    return atNorm_(atText_(m.properties['氏名'])) === atNorm_(name) ||
      atNorm_(atText_(m.properties['占い師名'])) === atNorm_(name);
  })[0];
  if (!me) throw new Error('お名前が会員名簿と一致しませんでした。登録名でお試しいただくか、主催者にご連絡ください。');

  // 3) 既に記録済みなら二重登録しない（冪等）
  const dup = atQueryAll_(AT_ATTEND_DB, {
    and: [
      { property: '会員', relation: { contains: me.id } },
      { property: 'イベント', relation: { contains: ev.id } },
    ],
  });
  if (dup.length) {
    // 申込→出席への更新のみ行う
    atApi_('pages/' + dup[0].id, 'patch', { properties: { '状態': { select: { name: '出席' } } } });
  } else {
    atApi_('pages', 'post', {
      parent: { database_id: AT_ATTEND_DB },
      properties: {
        '記録': { title: [{ text: { content: held + ' ' + evName + ' ' + atText_(me.properties['氏名']) } }] },
        '会員': { relation: [{ id: me.id }] },
        'イベント': { relation: [{ id: ev.id }] },
        '状態': { select: { name: '出席' } },
        '種別': kind ? { select: { name: kind } } : undefined,
        '開催日': { date: { start: held } },
        '取込元': { select: { name: 'フォーム' } },
      },
    });
  }

  // 4) その会員の当該四半期スコアを再計算
  recomputeMemberScore_(me.id, atQuarterOf_(held));

  return jsonOutput({
    status: 'success',
    message: '出席を受け付けました：' + evName,
    event: evName,
    name: atText_(me.properties['氏名']),
  });
}

// ────────────────────────────────────────────────────────────
// スコア自動集計（参加記録から再計算）
// ────────────────────────────────────────────────────────────

/** 四半期の開始・終了日 */
function atQuarterRange_(quarter) {
  const y = Number(quarter.slice(0, 4));
  const q = Number(quarter.slice(6));
  const startM = (q - 1) * 3 + 1;
  const endM = startM + 2;
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  const lastDay = new Date(y, endM, 0).getDate();
  return { start: y + '-' + pad(startM) + '-01', end: y + '-' + pad(endM) + '-' + pad(lastDay) };
}

/**
 * 会員1名の、指定四半期のスコア行を参加記録から再計算して書き込む
 * @param {string} memberId 会員ページID
 * @param {string} quarter "2026-Q3"
 */
function recomputeMemberScore_(memberId, quarter) {
  const range = atQuarterRange_(quarter);

  // その会員の当該四半期の参加記録
  const recs = atQueryAll_(AT_ATTEND_DB, {
    and: [
      { property: '会員', relation: { contains: memberId } },
      { property: '開催日', date: { on_or_after: range.start } },
      { property: '開催日', date: { on_or_before: range.end } },
    ],
  });

  // カウント系を集計（状態=出席 のみ）
  const counts = {};
  Object.keys(KIND_TO_FIELD).forEach(function (k) { counts[KIND_TO_FIELD[k]] = 0; });
  let zoomAttended = 0;
  recs.forEach(function (r) {
    const st = r.properties['状態'] && r.properties['状態'].select && r.properties['状態'].select.name;
    if (st !== '出席') return;
    const kind = r.properties['種別'] && r.properties['種別'].select && r.properties['種別'].select.name;
    if (KIND_TO_FIELD[kind]) counts[KIND_TO_FIELD[kind]]++;
    if (kind === RATE_KIND) zoomAttended++;
  });

  // zoom解放日の出席率（%）＝ 出席回数 ÷ その四半期に開催された zoom解放日の数
  const zoomHeld = atQueryAll_(AT_EVENT_DB, {
    and: [
      { property: '種別', select: { equals: RATE_KIND } },
      { property: '開催日', date: { on_or_after: range.start } },
      { property: '開催日', date: { on_or_before: range.end } },
      { property: '開催日', date: { on_or_before: atTodayJst_() } },
    ],
  }).length;
  const rate = zoomHeld > 0 ? Math.round((zoomAttended / zoomHeld) * 100) : 0;

  // スコア行を特定（会員×四半期）
  const rows = atQueryAll_(AT_SCORE_DB, {
    and: [
      { property: '会員', relation: { contains: memberId } },
      { property: '四半期', select: { equals: quarter } },
    ],
  });
  if (!rows.length) return; // 行が無ければ何もしない（繰り越し未実行）

  const props = {};
  Object.keys(counts).forEach(function (field) { props[field] = { number: counts[field] }; });
  props[RATE_FIELD] = { number: rate };
  atApi_('pages/' + rows[0].id, 'patch', { properties: props });
}

/** 【手動実行】指定四半期の全会員を再集計 */
function recomputeAllScores() {
  const quarter = atQuarterOf_(atTodayJst_());
  const members = atQueryAll_(AT_MEMBER_DB);
  let n = 0;
  members.forEach(function (m) {
    try { recomputeMemberScore_(m.id, quarter); n++; } catch (e) { console.error(e.message); }
    Utilities.sleep(200);
  });
  console.log(quarter + ' の再集計完了: ' + n + '名');
}

// ────────────────────────────────────────────────────────────
// 連続参加ボーナス（3ヶ月連続皆勤 → 称号）
// ────────────────────────────────────────────────────────────

/**
 * 【手動 or 月次トリガー】直近3ヶ月、毎月の定例会にすべて出席した会員へ
 * 称号「皆勤賞」を付与する。
 */
function awardStreakBadges() {
  const BADGE = '皆勤賞';
  const now = new Date();
  const months = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      y: d.getFullYear(), m: d.getMonth() + 1,
      start: Utilities.formatDate(new Date(d.getFullYear(), d.getMonth(), 1), 'Asia/Tokyo', 'yyyy-MM-dd'),
      end: Utilities.formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0), 'Asia/Tokyo', 'yyyy-MM-dd'),
    });
  }

  // 各月に開催された定例会
  const monthly = months.map(function (mo) {
    const evs = atQueryAll_(AT_EVENT_DB, {
      and: [
        { property: '種別', select: { equals: '定例会' } },
        { property: '開催日', date: { on_or_after: mo.start } },
        { property: '開催日', date: { on_or_before: mo.end } },
      ],
    });
    return { ids: evs.map(function (e) { return e.id; }), start: mo.start, end: mo.end };
  });
  // 1回も開催が無い月がある場合は判定しない（誤付与を防ぐ）
  if (monthly.some(function (mo) { return mo.ids.length === 0; })) {
    console.log('直近3ヶ月に定例会が無い月があるため、判定をスキップしました。');
    return;
  }

  const members = atQueryAll_(AT_MEMBER_DB);
  let awarded = 0;
  members.forEach(function (m) {
    const ok = monthly.every(function (mo) {
      const recs = atQueryAll_(AT_ATTEND_DB, {
        and: [
          { property: '会員', relation: { contains: m.id } },
          { property: '状態', select: { equals: '出席' } },
          { property: '開催日', date: { on_or_after: mo.start } },
          { property: '開催日', date: { on_or_before: mo.end } },
          { property: '種別', select: { equals: '定例会' } },
        ],
      });
      const attended = {};
      recs.forEach(function (r) {
        (r.properties['イベント'].relation || []).forEach(function (x) { attended[x.id] = true; });
      });
      return mo.ids.every(function (id) { return attended[id]; });
    });
    if (!ok) return;

    const cur = (m.properties['称号'] && m.properties['称号'].multi_select) || [];
    if (cur.some(function (o) { return o.name === BADGE; })) return; // 付与済み
    atApi_('pages/' + m.id, 'patch', {
      properties: { '称号': { multi_select: cur.map(function (o) { return { name: o.name }; }).concat([{ name: BADGE }]) } },
    });
    awarded++;
    Utilities.sleep(200);
  });
  console.log('皆勤賞を ' + awarded + '名に付与しました。');
}
