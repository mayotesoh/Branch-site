# Branch

占い師のための教育コミュニティ「Branch」の公式サイト。
[Astro](https://astro.build/) で構築した静的サイトで、GitHub Pages にデプロイします。

## 技術構成

- **Astro 5**（静的サイトジェネレーター）
- **GitHub Pages**（ホスティング）
- **GitHub Actions**（自動ビルド & デプロイ）

## セットアップ

```bash
npm install        # 依存パッケージのインストール
npm run dev        # 開発サーバー起動（http://localhost:4321）
npm run build      # 本番ビルド（dist/ に出力）
npm run preview    # ビルド結果をローカルで確認
```

## ディレクトリ構成

```
.
├── public/                # 静的ファイル（favicon など）
├── src/
│   ├── components/        # Header / Footer などの共通パーツ
│   ├── layouts/           # ページ共通レイアウト
│   ├── pages/             # 各ページ（ファイル＝URL）
│   │   ├── index.astro    # トップページ
│   │   └── join.astro     # 参加ページ
│   └── styles/            # グローバルCSS
├── astro.config.mjs       # Astro 設定（site / base）
└── .github/workflows/     # GitHub Actions（デプロイ）
```

## GitHub Pages へのデプロイ

1. このリポジトリを GitHub に push します。
2. リポジトリの **Settings → Pages → Build and deployment** で
   Source を **GitHub Actions** に設定します。
3. `main` ブランチへ push すると自動でビルド & デプロイされます。

### 公開URLに合わせた設定

`astro.config.mjs` の `site` と `base` を環境に合わせて変更してください。

| 公開先 | site | base |
| --- | --- | --- |
| プロジェクトページ（例: `user.github.io/Branch-site/`） | `https://user.github.io` | `/Branch-site` |
| ユーザー/組織ページ（`user.github.io`） | `https://user.github.io` | `/` |
| 独自ドメイン | `https://example.com` | `/` |

> 初期値はプロジェクトページ（`/Branch-site`）を想定しています。
> リポジトリ名やユーザー名に合わせて書き換えてください。
