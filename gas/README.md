# Branch 予約API（Google Apps Script）

LINE LIFF アプリから送信された予約データを Google スプレッドシートへ自動転記する Web API です。

## セットアップ手順

1. [Google Apps Script](https://script.google.com/) で新規プロジェクトを作成
2. `Code.gs` の内容を貼り付けて保存
3. **デプロイ → 新しいデプロイ** を選択
   - 種類: **ウェブアプリ**
   - 実行ユーザー: **自分**
   - アクセスできるユーザー: **全員**
4. 発行された **ウェブアプリURL**（`https://script.google.com/macros/s/XXXX/exec`）を控える
5. 初回デプロイ時に権限の承認（スプレッドシートへのアクセス）を許可

> スプレッドシートID `1bsp2ZZVIA_VplkT1eCt0rUmbYOmIIn9I3dIgem4fA7Y` の
> **最初のシート**に `[タイムスタンプ, userName, userId, date, time]` を追記します。
> 見出し行が無い場合は初回書き込み時に自動で追加します。

## CORS について（重要）

GAS の `ContentService` は `Access-Control-Allow-Origin` などの
レスポンスヘッダーを設定できません。
そのため **フロント（LIFF）側で `Content-Type: text/plain;charset=utf-8` を指定**して送信します。
これにより CORS プリフライト（OPTIONS）が発生しない「単純リクエスト」となり、
クロスドメインでもエラーになりません。

## フロントエンド（LIFF）側 送信サンプル

```javascript
const GAS_URL = 'https://script.google.com/macros/s/XXXX/exec'; // ←デプロイURL

async function sendReservation({ userName, userId, date, time }) {
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      // ★ application/json にしない（プリフライト回避のため text/plain）
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ userName, userId, date, time }),
    });
    const result = await res.json();
    if (result.status === 'success') {
      alert('予約を受け付けました。');
    } else {
      alert('エラー: ' + result.message);
    }
    return result;
  } catch (e) {
    alert('送信に失敗しました。通信環境をご確認ください。');
    throw e;
  }
}

// LIFF からユーザー情報を取得して送信する例
// const profile = await liff.getProfile();
// sendReservation({
//   userName: profile.displayName,
//   userId: profile.userId,
//   date: '2026-07-01',
//   time: '14:00',
// });
```

## レスポンス

| 状態 | レスポンス例 |
| --- | --- |
| 成功 | `{"status":"success"}` |
| 失敗 | `{"status":"error","message":"必須項目が不足しています（userId / date / time）。"}` |
