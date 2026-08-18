// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages ＋ 独自ドメイン（fortunelabo.com）用の設定
// ─────────────────────────────────────────────────────────
// 独自ドメインはルート直下で配信されるため base は '/'。
// リポジトリ名は Branch-site のままだが、URLは独自ドメインに一本化。
// 旧ドメイン fortunelab-marchfourth.com は GitHub が新ドメインへ自動301転送する。
// ─────────────────────────────────────────────────────────
export default defineConfig({
  site: 'https://fortunelabo.com',
  base: '/',
  output: 'static',
});
