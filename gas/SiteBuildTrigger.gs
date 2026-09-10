/**
 * サイト自動更新トリガー（GitHub Actions を GAS から叩く）
 *
 * GitHubのスケジュール(cron)は混雑時に大幅に間引かれて不規則になるため、
 * 「時間どおりに確実に動く」GASの時間主導トリガーからビルドを起動する。
 *
 * ■ 事前設定（1回だけ）
 *   1) GitHubで Fine-grained personal access token を発行
 *      - Repository access: mayotesoh/Branch-site のみ
 *      - Permissions: Actions = Read and write（Contents 不要）
 *   2) GASの「プロジェクトの設定 → スクリプト プロパティ」に登録
 *      - キー: GH_TOKEN   値: 発行したトークン
 *   3) この関数を1回実行: setupSiteBuildTrigger()  → 30分ごとに自動ビルド
 *
 * ■ 即時ビルドしたいとき
 *   triggerSiteBuild() を手動実行するだけ。
 */

const GH_OWNER = 'mayotesoh';
const GH_REPO = 'Branch-site';

/** GitHub Actions に repository_dispatch(rebuild) を送ってビルドを起動 */
function triggerSiteBuild() {
  const token = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (!token) throw new Error('スクリプトプロパティ GH_TOKEN が未設定です。');
  const url = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/dispatches';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: JSON.stringify({ event_type: 'rebuild' }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  // 204 No Content が成功
  if (code !== 204) {
    console.error('ビルド起動に失敗: ' + code + ' ' + res.getContentText());
    throw new Error('GitHub dispatch failed: ' + code);
  }
  console.log('サイトビルドを起動しました。');
}

/** 30分ごとの自動ビルドトリガーを設定（重複作成を防止） */
function setupSiteBuildTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'triggerSiteBuild'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('triggerSiteBuild').timeBased().everyMinutes(30).create();
  console.log('30分ごとの自動ビルドトリガーを設定しました。');
}

/* ============================================================
 * 「Notionを更新したら自動でビルド」＝変更検知ポーリング（推奨）
 *   5分ごとに各DBの最終編集時刻を調べ、前回ビルド以降に更新が
 *   あったときだけビルドを起動する（無変更なら何もしない）。
 *   依存: CoursePayment.gs の cpApi_（Notionトークンで叩く）
 * ============================================================ */

// サイト表示に影響するDB（これらが編集されたらビルド）
const SB_WATCH_DBS = [
  '04e8f32855ae4e80865ab3f2b92798cb', // ブログ
  '30e989297ce14ea99cbea84a2e5e2180', // 講師/スタッフ
  '9e653e0af59e47ebb3c1c9d443339e48', // 講座
  '3a776a170aae814d8066e4c4161e9961', // イベント
  '3a776a170aae81e88abbd889d401e589', // お客様の声
  '3d276a170aae81c2a286d911351cf3dc', // お題
  '3d276a170aae81c28f3acf6a1b4f0eb8', // 読み解き回答
  '3d276a170aae819fb797f0aad61dfac1', // クイズ
];

/** 各DBの最新 last_edited_time の最大値（ISO文字列）を返す */
function sbLatestEditISO_() {
  var maxT = '';
  for (var i = 0; i < SB_WATCH_DBS.length; i++) {
    try {
      var b = cpApi_('databases/' + SB_WATCH_DBS[i] + '/query', 'post', {
        page_size: 1,
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      });
      var r = (b.results || [])[0];
      var t = r ? r.last_edited_time : '';
      if (t && t > maxT) maxT = t;
    } catch (e) {
      console.warn('DB確認に失敗: ' + SB_WATCH_DBS[i] + ' ' + e.message);
    }
  }
  return maxT;
}

/** 【5分トリガー用】前回ビルド以降にNotion更新があればビルドを起動 */
function autoBuildOnNotionChange() {
  var props = PropertiesService.getScriptProperties();
  var last = props.getProperty('SB_LAST_BUILT_EDIT') || '';
  var latest = sbLatestEditISO_();
  if (!latest) { console.log('編集時刻を取得できませんでした。スキップ。'); return; }
  if (latest > last) {
    triggerSiteBuild();
    props.setProperty('SB_LAST_BUILT_EDIT', latest);
    console.log('Notion更新を検知 → ビルド起動（' + latest + '）');
  } else {
    console.log('更新なし。ビルドは起動しません。');
  }
}

/** 変更検知の自動ビルドを設定（5分ごと・重複作成を防止） */
function setupNotionChangeAutoBuild() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'autoBuildOnNotionChange'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('autoBuildOnNotionChange').timeBased().everyMinutes(5).create();
  // 初回は「今の状態」を基準にして、無駄な初回ビルドを避ける
  PropertiesService.getScriptProperties().setProperty('SB_LAST_BUILT_EDIT', sbLatestEditISO_());
  console.log('5分ごとの変更検知オートビルドを設定しました。');
}
