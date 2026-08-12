// サイト全体で使う共通定数

/**
 * 姉妹サイト（Lab online（仮））へのリンク
 * Fortune Labo は占い師向けの学び・育成コミュニティ。
 * Lab online（仮） は Fortune Labo 出身の占い師が相談者を鑑定する鑑定サイト。
 * ※ base が異なるため相手サイトへは絶対URLでリンクする。
 */
export const SISTER_SITE_URL = 'https://mayotesoh.github.io/fortune-lab/';
export const SISTER_SITE_NAME = 'Lab online（仮）';
export const SISTER_SITE_DESC = '占い鑑定';

/**
 * Instagram プロフィールURL（「フォローはこちら」導線に使用）
 * 例：'https://www.instagram.com/branch_uranai/'
 * 空文字ならフォローボタンは表示されません。
 */
export const INSTAGRAM_URL = '';

/**
 * PAY.JP 公開鍵（pk_test_… / pk_live_…）。公開鍵はクライアントに出しても安全。
 * 秘密鍵はGASのスクリプトプロパティへ。フロントとGASは必ず同じモードに。
 * 本番切替時は pk_live_13d6bd6a76607d4c6702a99b に差し替え＋GASを sk_live_ に。
 */
export const PAYJP_PUBLIC_KEY = 'pk_test_58c51cb25eec8a844a85bdf8';

/** 公式LINE 友だち追加・予約・相談リンク */
export const LINE_URL = 'https://lin.ee/SZZ4UJj';

/** LINEボタンの既定ラベル */
export const LINE_LABEL = 'LINEで予約・相談';

/** 予約データ送信先（Google Apps Script ウェブアプリURL） */
export const GAS_URL =
  'https://script.google.com/macros/s/AKfycbxaCiNBYjP6VeU-AZZHVRrnJhQNX3o4VA7NIZg4YIl6NO4Q3FNm3bDGfb6C2aRdd3ervg/exec';

/**
 * LIFF ID（LINE Developers コンソールで発行）
 * 未設定（空文字）の場合は、LINE外からの利用とみなして
 * 名前を手入力する「Web予約モード」で動作します。
 * LIFFアプリとして使う場合は、発行された LIFF ID を設定してください。
 */
export const LIFF_ID = '';

/** 予約できるコンテンツの種別（サイトフォーム / LINEで共通） */
export const CONTENT_TYPES = [
  '体験講座',
  '養成講座',
  '個別セッション',
  '練習会・ロープレ',
  '鑑定',
  'キャリア相談',
  'その他',
];
