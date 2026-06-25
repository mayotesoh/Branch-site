# Branch 予約API（Google Apps Script）

予約データを Google スプレッドシートへ転記する Web API です。
**サイトの予約フォーム / LIFF** と **LINE 対話式予約（Messaging API）** の両方を、
1つの `doPost` で受け付けます。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `Code.gs` | doPost ルーター・フォーム予約処理・シート追記 |
| `LineBot.gs` | LINE 対話式予約（コンテンツ選択→日時入力→シート反映） |
| `RichMenu.gs` | リッチメニュー作成（API利用時。任意） |

## スプレッドシートの列

```
タイムスタンプ | userName | userId | メールアドレス | date | time | コンテンツ
```

> 旧仕様（メールアドレス・コンテンツ列なし）から変更した場合は、
> 一度だけ `Code.gs` の **`resetHeaders()`** を実行すると見出しを作り直せます
> （※既存データは消えます。テスト行の掃除を兼ねてどうぞ）。

## セットアップ

### 1. コードの更新とデプロイ
1. [Google Apps Script](https://script.google.com/) の既存プロジェクトを開く
2. `Code.gs` / `LineBot.gs` / `RichMenu.gs` の内容を反映（新規ファイルは「ファイル＋」で追加）
3. **デプロイ → デプロイを管理 → 編集（鉛筆）→ 新バージョン → デプロイ**
   - アクセスできるユーザー: **全員**／実行するユーザー: **自分**（URLは変わりません）

### 2. LINE Messaging API の設定（対話式予約）
1. [LINE Developers](https://developers.line.biz/) で対象アカウントの **Messaging API チャネル** を開く
2. **チャネルアクセストークン（長期）** を発行し、`LineBot.gs` の
   `LINE_CHANNEL_ACCESS_TOKEN` に貼り付け
3. **Webhook URL** に GAS のデプロイURL（`.../exec`）を設定し、**Webhookの利用をON**
4. **応答メッセージ（自動応答）をOFF** にする（ボットが返信を制御するため）

### 3. リッチメニュー（小・1枠）
**かんたん（推奨・コード不要）**: LINE公式アカウントマネージャー → リッチメニュー → 作成
- テンプレート: 「小」の1枠
- 画像: 2500×843 PNG/JPEG（`public/richmenu.svg` をPNG書き出し可）
- アクション: **「テキスト」→「予約」**（タップで予約フロー開始）

**APIで作る場合**: `RichMenu.gs` の `createReserveRichMenu()` →
`uploadRichMenuImage()` → `setDefaultRichMenu()` を順に実行。

## 対話の流れ（LINE）

1. リッチメニューをタップ（または「予約」と送信）
2. コンテンツをクイックリプライから選択
3. 希望日時を入力（例: `2026-07-01 14:00`）
4. スプレッドシートに追記され、完了メッセージが返信される

## サイトフォーム送信サンプル（参考）

```javascript
await fetch(GAS_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // ★ CORS回避
  body: JSON.stringify({ userName, userId, email, content, date, time }),
});
```

## レスポンス

| 状態 | 例 |
| --- | --- |
| 成功 | `{"status":"success"}` |
| 失敗 | `{"status":"error","message":"必須項目が不足しています（userId / content / date / time）。"}` |
| LINE Webhook受信 | `{"status":"ok"}` |
