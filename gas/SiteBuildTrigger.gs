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
