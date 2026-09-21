import fs from 'node:fs';
const TOKEN=(fs.readFileSync('.env','utf8').match(/^NOTION_TOKEN=(.+)$/m)||[])[1]?.trim().replace(/^"|"$/g,'');
const EVENT_DB='3a776a170aae814d8066e4c4161e9961';
const INSTR_DB='30e989297ce14ea99cbea84a2e5e2180';
const res=await fetch('https://api.notion.com/v1/databases/'+EVENT_DB,{method:'PATCH',headers:{Authorization:'Bearer '+TOKEN,'Notion-Version':'2022-06-28','Content-Type':'application/json'},body:JSON.stringify({properties:{'参加講師':{relation:{database_id:INSTR_DB,single_property:{}}}}})});
const j=await res.json();
if(!res.ok){console.error('ERR',res.status,JSON.stringify(j,null,2));process.exit(1);}
console.log('OK: 参加講師 relation added. props now:',Object.keys(j.properties).join(', '));
