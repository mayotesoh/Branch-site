/**
 * Fortune Labo ─ NotionイベントDB → Google カレンダー 一方向同期
 * ----------------------------------------------------------------------
 * Notion を「正（source of truth）」にして、イベントを Google カレンダーへ反映します。
 * ・専用カレンダー「Fortune Labo イベント」を自動作成し、そこへ書き込みます。
 * ・毎回「前回同期した予定を消して作り直す」方式なので、Notion側の追加・変更・削除が
 *   そのまま反映されます（カレンダー側で編集しても次回同期で上書きされます）。
 * ・合言葉などの内部情報はカレンダーに出しません。
 *
 * 【使い方（初回のみ）】
 *   1) このファイルを GAS プロジェクトに追加
 *   2) 関数 setupCalendarSyncTrigger を1回だけ実行（カレンダー権限を許可）
 *      → 「Fortune Labo イベント」カレンダーが作られ、1時間ごとに自動同期されます。
 *   3) Googleカレンダーでそのカレンダーを共有／公開／サイト埋め込みに使えます。
 * 依存：CoursePayment.gs の cpQuery_ / cpText_ / cpToday_。
 * ----------------------------------------------------------------------
 */

const CAL_EVENT_DB = '3a776a170aae814d8066e4c4161e9961'; // Fortune Labo イベントDB
const CAL_NAME = 'Fortune Labo イベント';

/** ページのタイトル（title型プロパティ）を項目名に依存せず取り出す */
function calTitle_(props) {
  // まず「イベント名」を優先、無ければ title 型のプロパティを探す
  if (props['イベント名'] && props['イベント名'].title) {
    return (props['イベント名'].title || []).map(function (x) { return x.plain_text; }).join('');
  }
  for (const k in props) {
    if (props[k] && props[k].type === 'title') {
      return (props[k].title || []).map(function (x) { return x.plain_text; }).join('');
    }
  }
  return '';
}

/** 同期先カレンダーを取得（無ければ作成） */
function calGet_() {
  const cals = CalendarApp.getCalendarsByName(CAL_NAME);
  if (cals && cals.length) return cals[0];
  return CalendarApp.createCalendar(CAL_NAME, {
    summary: 'Fortune Labo のイベント（Notionから自動同期）',
    color: CalendarApp.Color.BLUE,
  });
}

/**
 * NotionイベントDB → Google カレンダー へ同期（前回分を消して作り直す）
 * @return {number} 同期した件数
 */
function syncEventsToCalendar() {
  const cal = calGet_();
  const props = PropertiesService.getScriptProperties();
  let map = {};
  try { map = JSON.parse(props.getProperty('CAL_SYNC_MAP') || '{}'); } catch (e) {}

  // 前回同期した予定を削除
  Object.keys(map).forEach(function (pid) {
    try { const ev = cal.getEventById(map[pid]); if (ev) ev.deleteEvent(); } catch (e) {}
  });

  const rows = cpQuery_(CAL_EVENT_DB);
  const newMap = {};
  let count = 0;
  rows.forEach(function (r) {
    const p = r.properties;
    const d = p['開催日'] && p['開催日'].date;
    if (!d || !d.start) return; // 日付なしはスキップ
    const name = calTitle_(p) || 'イベント';
    const type = (p['種別'] && p['種別'].select) ? p['種別'].select.name : '';
    const memo = cpText_(p['メモ']);
    const url = (p['案内URL'] && p['案内URL'].url) ? p['案内URL'].url : '';
    const accepting = !!(p['受付中'] && p['受付中'].checkbox);
    const desc = [
      type ? '種別：' + type : '',
      accepting ? '受付中' : '',
      memo,
      url ? '詳細・申込：' + url : '',
    ].filter(String).join('\n\n');

    let ev;
    if (d.start.indexOf('T') >= 0) {
      const start = new Date(d.start);
      const end = d.end ? new Date(d.end) : new Date(start.getTime() + 60 * 60 * 1000);
      ev = cal.createEvent(name, start, end, { description: desc });
    } else {
      const day = new Date(d.start);
      ev = cal.createAllDayEvent(name, day, { description: desc });
    }
    newMap[r.id] = ev.getId();
    count++;
  });

  props.setProperty('CAL_SYNC_MAP', JSON.stringify(newMap));
  console.log('カレンダー同期：' + count + '件');
  return count;
}

/** 【初回1回だけ実行】1時間ごとの自動同期トリガーを設定＋即時同期 */
function setupCalendarSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'syncEventsToCalendar') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('syncEventsToCalendar').timeBased().everyHours(1).create();
  const n = syncEventsToCalendar();
  const cal = calGet_();
  console.log('自動同期を設定しました（1時間ごと）。カレンダーID：' + cal.getId() + ' / 初回同期 ' + n + '件');
}

/** カレンダーIDと公開URLの確認用 */
function showCalendarInfo() {
  const cal = calGet_();
  console.log('カレンダー名：' + cal.getName());
  console.log('カレンダーID：' + cal.getId());
  console.log('※GoogleカレンダーのUIから「設定と共有」→公開／共有／埋め込みコードを取得できます。');
}
