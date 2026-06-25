// サイト全体で使う共通定数

/** 公式LINE 友だち追加・予約・相談リンク */
export const LINE_URL = 'https://lin.ee/SvCKDYoj';

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
