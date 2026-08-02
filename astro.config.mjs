// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages ＋ 独自ドメイン（fortunelab-marchfourth.com）用の設定
// ─────────────────────────────────────────────────────────
// 独自ドメインはルート直下で配信されるため base は '/'。
// リポジトリ名は Branch-site のままだが、URLは独自ドメインに一本化。
// 旧URL（mayotesoh.github.io/Branch-site/…）は GitHub が自動転送する。
// ─────────────────────────────────────────────────────────
export default defineConfig({
  site: 'https://fortunelab-marchfourth.com',
  base: '/',
  output: 'static',
});
