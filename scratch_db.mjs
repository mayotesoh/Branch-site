import fs from 'node:fs';
const token=(fs.readFileSync('.env','utf-8').match(/NOTION_TOKEN=(.+)/)||[])[1]?.trim();
const h={Authorization:'Bearer '+token,'Notion-Version':'2022-06-28','Content-Type':'application/json'};
const PARENT='39576a17-0aae-80dc-b3c0-cac81b6a2b65';
const MEMBER='ca1b82cb-70c3-4995-b15b-362181c387cd';
const KINDS=['定例会','スキルアップ講座','リーディング会','ロープレ','マルシェ・イベント','zoom解放日'];

const create=async(title,desc,props)=>{
  const r=await (await fetch('https://api.notion.com/v1/databases',{method:'POST',headers:h,body:JSON.stringify({
    parent:{type:'page_id',page_id:PARENT},
    title:[{type:'text',text:{content:title}}],
    description:[{type:'text',text:{content:desc}}],
    properties:props})})).json();
  if(r.object==='error'){console.log(`✗ ${title}: ${r.message}`);process.exit(1);}
  console.log(`✓ ${title} 作成: ${r.id}`);
  return r.id;
};

// イベントDB（開催予定の管理・合言葉）
const EVENT=await create('Branch イベントDB','定例会・セミナー等の開催予定。合言葉で出席受付を行う。',{
  'イベント名':{title:{}},
  '種別':{select:{options:KINDS.map(n=>({name:n}))}},
  '開催日':{date:{}},
  '合言葉':{rich_text:{}},
  '受付中':{checkbox:{}},
  '案内URL':{url:{}},
  'メモ':{rich_text:{}},
});

// 参加記録DB（1行＝会員×イベント）
const ATT=await create('Branch 参加記録DB','1行＝会員×イベント。出席/欠席を記録し、スコアへ自動集計する。',{
  '記録':{title:{}},
  '会員':{relation:{database_id:MEMBER,type:'dual_property',dual_property:{}}},
  'イベント':{relation:{database_id:EVENT,type:'dual_property',dual_property:{}}},
  '状態':{select:{options:[{name:'出席'},{name:'欠席'},{name:'申込'}]}},
  '種別':{select:{options:KINDS.map(n=>({name:n}))}},
  '開催日':{date:{}},
  '取込元':{select:{options:[{name:'フォーム'},{name:'手動'},{name:'Zoom'},{name:'LINE'}]}},
});
fs.writeFileSync('.dbids',JSON.stringify({EVENT,ATT}));

// 会員DB側の逆リレーション名を整える
const mdb=await (await fetch('https://api.notion.com/v1/databases/'+MEMBER,{headers:h})).json();
const back=Object.entries(mdb.properties).find(([,d])=>d.type==='relation'&&d.relation.database_id.replace(/-/g,'')===ATT.replace(/-/g,''));
if(back){
  const r=await (await fetch('https://api.notion.com/v1/databases/'+MEMBER,{method:'PATCH',headers:h,
    body:JSON.stringify({properties:{[back[0]]:{name:'参加記録'}}})})).json();
  console.log(r.object==='error'?'✗ rename: '+r.message:'✓ 会員DBの逆リレーションを「参加記録」にリネーム');
}
