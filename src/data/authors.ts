// 記事の著者（所属占い師）。ブログの著者別ページと共通で使う。
// Notion連携時は、この配列を Notion「講師DB」から生成するように差し替える想定。

export interface Author {
  /** 記事フロントマターの author に書くID */
  id: string;
  name: string;
  kana?: string;
  /** public/ 配下の画像ファイル名 */
  image: string;
  role: string;
}

export const authors: Author[] = [
  {
    id: 'haruna',
    name: '春名 渼月',
    kana: 'はるな みづき',
    image: 'sibusawa.webp',
    role: '理論派占い師＆当たる占い師養成講師',
  },
  {
    id: 'taki',
    name: '多喜 渼春',
    kana: 'たき みはる',
    image: 'harutyan.webp',
    role: '感覚派占い師＆当たる占い師養成講師',
  },
];

export const getAuthor = (id: string): Author | undefined =>
  authors.find((a) => a.id === id);
