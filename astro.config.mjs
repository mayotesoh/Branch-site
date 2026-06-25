// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages 用の設定
// ─────────────────────────────────────────────────────────
// プロジェクトページ（https://<ユーザー名>.github.io/Branch-site/）に
// デプロイする想定の初期値です。
//
//  - 独自ドメインや <ユーザー名>.github.io リポジトリを使う場合は
//    `base` を '/' に変更し、`site` を実際のURLに書き換えてください。
//  - リポジトリ名を変えた場合は `base` を合わせて変更してください。
// ─────────────────────────────────────────────────────────
export default defineConfig({
  site: 'https://example.github.io',
  base: '/Branch-site',
  output: 'static',
});
