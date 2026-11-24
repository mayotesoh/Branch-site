/**
 * Fortune Labo ─ 運営・講師むけ 管理ポータル（点呼・出欠記録）
 * ----------------------------------------------------------------------
 * サイトの /staff-admin から呼ばれる。会員番号＋暗証番号でログインし、
 * 「区分＝運営 または 講師」の会員のみ管理操作を許可する。
 *
 *   admin_login   … ログイン（権限確認）＋ 直近イベント一覧を返す
 *   admin_roster  … 指定イベントの会員名簿＋各自の出欠状態を返す
 *   admin_mark    … 指定会員×イベントの出欠（出席/欠席/申込/クリア）を記録
 *
 * 依存：MemberPortal.gs（mpFindMember_, mpEventInfo_, mpFindPart_, MP_PART_DB）
 *       CoursePayment.gs（cpApi_, cpQuery_, cpText_, CP_MEMBER_DB, cpToday_）
 *       Attendance.gs（recomputeMemberScore_, atQuarterOf_, AT_EVENT_DB）
 *       Code.gs（jsonOutput）
 * ----------------------------------------------------------------------
 */

/** 管理操作を許可する区分 */
const ADM_ROLES = ['運営', '講師'];
/** 点呼でつけられる状態 */
const ADM_STATES = ['出席', '欠席', '申込'];

/** 会員番号＋暗証番号で照合し、区分が運営/講師であることを確認して会員ページを返す */
function admFindStaff_(no, pin) {
  const hit = mpFindMember_(no, pin); // 不一致はここで例外
  const role = (hit.properties['区分'] && hit.properties['区分'].select)
    ? hit.properties['区分'].select.name : '';
  if (ADM_ROLES.indexOf(role) < 0) {
    throw new Error('この機能は運営・講師のみご利用いただけます。');
  }
  hit._role = role;
  return hit;
}

/** 日付文字列 → yyyy-MM-dd（時刻付きでも先頭10文字） */
function admDay_(s) { return String(s || '').slice(0, 10); }

/**
 * 管理ログイン（admin_login）：権限確認＋直近イベント一覧
 * 窓: 今日の21日前 〜 45日後。新しい順（点呼は当日分が上に来る）。
 * @param {{memberNo:string, pin:string}} data
 */
function handleAdminLogin(data) {
  const staff = admFindStaff_(data.memberNo, data.pin);

  const now = new Date();
  const from = new Date(now.getTime() - 21 * 86400000);
  const to = new Date(now.getTime() + 45 * 86400000);
  const fmt = function (d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'); };

  const evs = cpApi_('databases/' + AT_EVENT_DB + '/query', 'post', {
    page_size: 100,
    filter: {
      and: [
        { property: '開催日', date: { on_or_after: fmt(from) } },
        { property: '開催日', date: { on_or_before: fmt(to) } },
      ],
    },
    sorts: [{ property: '開催日', direction: 'descending' }],
  });
  const events = (evs.results || []).map(function (e) {
    const p = e.properties;
    return {
      id: e.id,
      name: cpText_(p['イベント名']),
      type: (p['種別'] && p['種別'].select) ? p['種別'].select.name : '',
      date: (p['開催日'] && p['開催日'].date) ? p['開催日'].date.start : '',
    };
  });

  return jsonOutput({
    status: 'ok',
    name: cpText_(staff.properties['氏名']),
    tellerName: cpText_(staff.properties['占い師名']),
    role: staff._role,
    events: events,
  });
}

/**
 * 点呼名簿（admin_roster）：指定イベントの全会員＋各自の出欠状態
 * @param {{memberNo:string, pin:string, eventId:string}} data
 */
function handleAdminRoster(data) {
  admFindStaff_(data.memberNo, data.pin);
  const eventId = String(data.eventId || '').trim();
  if (!eventId) throw new Error('イベントが指定されていません。');

  const info = mpEventInfo_(eventId); // {name,type,date,...}

  // このイベントの参加記録をまとめて取得 → 会員ID→状態 のマップ
  const statusByMember = {};
  const recs = [];
  var cursor;
  do {
    const b = cpApi_('databases/' + MP_PART_DB + '/query', 'post', {
      page_size: 100, start_cursor: cursor,
      filter: { property: 'イベント', relation: { contains: eventId } },
    });
    (b.results || []).forEach(function (r) { recs.push(r); });
    cursor = b.has_more ? b.next_cursor : undefined;
  } while (cursor);
  recs.forEach(function (r) {
    const rel = (r.properties['会員'] && r.properties['会員'].relation) ? r.properties['会員'].relation : [];
    const st = (r.properties['状態'] && r.properties['状態'].select) ? r.properties['状態'].select.name : '';
    rel.forEach(function (x) { statusByMember[x.id] = st; });
  });

  // 全会員（会員番号つきのみ）。会員番号で昇順。
  const members = cpQuery_(CP_MEMBER_DB)
    .map(function (m) {
      const p = m.properties;
      return {
        id: m.id,
        no: cpText_(p['会員番号']),
        name: cpText_(p['氏名']),
        tellerName: cpText_(p['占い師名']),
        kubun: (p['区分'] && p['区分'].select) ? p['区分'].select.name : '',
        status: statusByMember[m.id] || '',
      };
    })
    .filter(function (m) { return m.no; })
    .sort(function (a, b) { return a.no < b.no ? -1 : (a.no > b.no ? 1 : 0); });

  return jsonOutput({
    status: 'ok',
    event: { id: eventId, name: info.name, type: info.type, date: info.date },
    members: members,
    counts: {
      total: members.length,
      attended: members.filter(function (m) { return m.status === '出席'; }).length,
      absent: members.filter(function (m) { return m.status === '欠席'; }).length,
      applied: members.filter(function (m) { return m.status === '申込'; }).length,
    },
  });
}

/**
 * 出欠記録（admin_mark）：会員×イベントの状態を設定（冪等）
 *   status が '出席'/'欠席'/'申込' → 既存を更新 or 新規作成
 *   status が ''（空） → 既存記録を取り消し（アーカイブ）
 * @param {{memberNo:string, pin:string, eventId:string, targetId:string, status:string}} data
 */
function handleAdminMark(data) {
  admFindStaff_(data.memberNo, data.pin);
  const eventId = String(data.eventId || '').trim();
  const targetId = String(data.targetId || '').trim();
  const status = String(data.status || '').trim();
  if (!eventId) throw new Error('イベントが指定されていません。');
  if (!targetId) throw new Error('対象の会員が指定されていません。');
  if (status && ADM_STATES.indexOf(status) < 0) throw new Error('不正な状態です。');

  const info = mpEventInfo_(eventId);
  const existing = mpFindPart_(targetId, eventId);

  if (!status) {
    // クリア（取り消し）
    if (existing) cpApi_('pages/' + existing.id, 'patch', { archived: true });
  } else if (existing) {
    cpApi_('pages/' + existing.id, 'patch', { properties: { '状態': { select: { name: status } } } });
  } else {
    const props = {
      '記録': { title: [{ text: { content: (info.name || 'イベント') } }] },
      '会員': { relation: [{ id: targetId }] },
      'イベント': { relation: [{ id: eventId }] },
      '状態': { select: { name: status } },
      '取込元': { select: { name: '手動' } },
    };
    if (info.type) props['種別'] = { select: { name: info.type } };
    if (info.date) props['開催日'] = { date: { start: info.date } };
    cpApi_('pages', 'post', { parent: { database_id: MP_PART_DB }, properties: props });
  }

  // スコア再計算（開催日の四半期）。失敗しても記録自体は成立させる。
  try {
    const day = admDay_(info.date) || cpToday_();
    recomputeMemberScore_(targetId, atQuarterOf_(day));
  } catch (e) {}

  return jsonOutput({ status: 'ok', state: status });
}
