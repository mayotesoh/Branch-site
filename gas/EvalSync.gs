/**
 * Fortune Labo ─ 鑑定ロープレ評価：Googleフォーム → スプレッドシート → Notion 自動同期
 * ----------------------------------------------------------------------
 * 使い方（初回に1回だけ）：
 *   1) この EvalSync.gs を貼り付けて保存
 *   2) 関数選択で setupEvalForm を選び「実行」→ 権限を許可
 *      → 評価入力フォームと回答スプレッドシートが自動作成され、
 *        送信時に Notion「鑑定ロープレ評価DB」へ同期するトリガーが設定されます。
 *      → 実行ログにフォームURL・スプシURLが出るので控えてください（評価者に共有）。
 *
 * 依存：CoursePayment.gs の cpApi_/cpQuery_/cpText_/cpNorm_ と CP_MEMBER_DB
 *       （NOTION_TOKEN はスクリプトプロパティ）
 * ----------------------------------------------------------------------
 */

const EVAL_DB_ID = '3cc76a17-0aae-81aa-a916-f611abe889b2'; // 鑑定ロープレ評価DB
const EVAL_KEYS = ['声・話し方', '聞く姿勢', '言葉選び', '鑑定の流れ', '鑑定内容', '安心感'];

/** 【初回のみ実行】評価フォーム＋回答スプシ＋送信トリガーを作成 */
function setupEvalForm() {
  const form = FormApp.create('Fortune Labo 鑑定ロープレ評価');
  form.setDescription('会員の鑑定ロープレを5段階（1〜5）で評価します。5=とても優れている / 1=改善が必要。');

  form.addTextItem().setTitle('会員番号').setHelpText('例：BR-001').setRequired(true);

  const labels = {
    '声・話し方': 'トーン・スピード・聞き取りやすさ',
    '聞く姿勢': '傾聴・共感・相づち',
    '言葉選び': '安心感・配慮・断定の回避',
    '鑑定の流れ': '構成・時間配分・説明',
    '鑑定内容': '伝え方・改善策・わかりやすさ',
    '安心感': '全体の雰囲気・終わり方',
  };
  EVAL_KEYS.forEach(function (k) {
    form.addScaleItem().setTitle(k).setHelpText(labels[k]).setBounds(1, 5)
      .setLabels('改善が必要', 'プロレベル').setRequired(true);
  });

  form.addParagraphTextItem().setTitle('総合コメント').setHelpText('全体の所感・良かった点・次回の課題など');
  form.addTextItem().setTitle('評価者').setHelpText('評価した人の名前');

  const ss = SpreadsheetApp.create('Fortune Labo 鑑定ロープレ評価（回答）');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // 二重登録を避けて送信トリガーを作成
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEvalFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEvalFormSubmit').forForm(form).onFormSubmit().create();

  console.log('✅ セットアップ完了');
  console.log('フォーム（評価者に共有）: ' + form.getPublishedUrl());
  console.log('編集用フォーム: ' + form.getEditUrl());
  console.log('回答スプレッドシート: ' + ss.getUrl());
}

/** フォーム送信時：回答を Notion 評価DB に1行作成（スプシにも自動蓄積される） */
function onEvalFormSubmit(e) {
  try {
    const map = {};
    e.response.getItemResponses().forEach(function (ir) {
      map[ir.getItem().getTitle()] = ir.getResponse();
    });
    const no = String(map['会員番号'] || '').trim();
    if (!no) return;

    // 会員照合（会員番号）
    const members = cpQuery_(CP_MEMBER_DB);
    let mid = null, name = '';
    for (let i = 0; i < members.length; i++) {
      if (cpNorm_(cpText_(members[i].properties['会員番号'])) === cpNorm_(no)) {
        mid = members[i].id;
        name = cpText_(members[i].properties['氏名']);
        break;
      }
    }

    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const props = {
      '評価': { title: [{ text: { content: today + ' ' + (name || no) + ' 鑑定ロープレ評価' } }] },
      '会員番号': { rich_text: [{ text: { content: no } }] },
      '評価日': { date: { start: today } },
      '評価者': { rich_text: [{ text: { content: String(map['評価者'] || '') } }] },
      '総合コメント': { rich_text: [{ text: { content: String(map['総合コメント'] || '') } }] },
    };
    EVAL_KEYS.forEach(function (k) {
      const v = parseInt(map[k], 10);
      if (!isNaN(v)) props[k] = { number: v };
    });
    if (mid) props['会員'] = { relation: [{ id: mid }] };

    cpApi_('pages', 'post', { parent: { database_id: EVAL_DB_ID }, properties: props });
  } catch (err) {
    console.error('鑑定ロープレ評価の同期エラー: ' + err);
  }
}
