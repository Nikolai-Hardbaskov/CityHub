const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const c={characterId:0,chatId:'social-conflict',name1:'Ариша',name2:'Леон',characters:[{description:'Леон вежливый.',mes_example:'Леон: Рад тебя видеть.'}],chat:[{name:'Леон',mes:'Леон ушёл.'},{name:'Ариша',mes:'Я занялась делами.',is_user:true}],chatMetadata:{},extensionSettings:{cityhub:{}},setExtensionPrompt(){}};
for(let i=0;i<30;i++)c.chat.push({name:'Леон',mes:'Обычный день '+i});
const env={console,Date,Math,JSON,Promise,Map,Set,WeakMap,WeakSet,SillyTavern:{getContext:()=>c},window:{addEventListener(){}},document:{getElementById:()=>null},jQuery(){},toastr:{info(){},success(){},warning(){},error(){}},setTimeout(){},clearTimeout(){},setInterval(){}};
vm.createContext(env);const source=fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8').replace('    globalThis.CityHub = {',`globalThis.test={authorRelations,voiceContext,aiComments,ACT,model:fn=>aiRaw=fn};save=()=>{};render=()=>{};globalThis.CityHub = {`);
vm.runInContext(source,env);const api=env.test,s=env.CityHub.state();s.auth=true;
s.lorePeople=[{name:'Марвин Бранаг',role:'adult',bio:'Вежливый коллега.'},{name:'Клэр Редфилд',role:'adult',bio:'Добрая подруга.'}];
const npc={id:'npc',name:'Марвин Бранаг',kind:'dm',known:true,rel:-12,status:'знакомые',msgs:[],conflict:{why:'NPC_OLD_CONFLICT: нарушенное обещание',source:'story'}};
const char={id:'char',name:'Леон',kind:'char',known:true,pair:true,rel:70,status:'пара',msgs:[],conflict:{why:'CHAR_CONFLICT: ревность',source:'story'}};
s.threads=[npc,char,{id:'claire',name:'Клэр Редфилд',kind:'dm',known:true,rel:60,status:'друзья',msgs:[]},{id:'group',name:'Группа',kind:'group',msgs:[],conflict:{why:'GROUP_SHOULD_NOT_APPEAR'}},{id:'official',name:'Ведомство',kind:'official',msgs:[],conflict:{why:'OFFICIAL_SHOULD_NOT_APPEAR'}}];
const p={id:'post',author:'Марвин Бранаг',text:'Прежний доброжелательный пост.',comments:[],t:1};s.feed=[p];
function check(prompt){for(const text of ['Марвин Бранаг: в ссоре','NPC_OLD_CONFLICT','Леон: в ссоре','CHAR_CONFLICT','Клэр Редфилд: друзья','вежливый ответ не означает дружбу или прощение','отсутствие упоминания ссоры не является примирением'])assert.ok(prompt.includes(text),text);}
(async()=>{
 check(await api.voiceContext(s,['Marvin Branagh','Клэр Редфилд']));
 let prompt;api.model(async p=>{prompt=p;return '[{"author":"Марвин Бранаг","text":"Обсудим это позже."}]';});await api.aiComments(s,p,'Ответь на комментарий.');check(prompt);assert.equal(npc.conflict.why,'NPC_OLD_CONFLICT: нарушенное обещание','generation does not reconcile');
 api.model(async p=>{prompt=p;return '{"posts":[{"author":"Марвин Бранаг","text":"Занят делами."}]}';});await api.ACT.genFeed({},null,s);check(prompt);assert.ok(npc.conflict);
 const selected=api.authorRelations(s,['Marvin Branagh']);assert.ok(selected.includes('NPC_OLD_CONFLICT'));assert.ok(!selected.includes('CHAR_CONFLICT'));assert.ok(!api.authorRelations(s,['Группа','Ведомство']).includes('SHOULD_NOT_APPEAR'));
 npc.reconciled={why:npc.conflict.why,source:'story'};npc.conflict=null;npc.rel=30;npc.status='приятели';const reconciled=api.authorRelations(s,['Марвин Бранаг']);assert.ok(reconciled.includes('Последняя ссора завершилась примирением'));assert.ok(!reconciled.includes('Неразрешённый конфликт'));
 // Automatic opening previews are not facts for persistent public relations.
 c.chat=[{name:'Ариша',mes:'Начни историю.',is_user:true},{name:'Леон',mes:'Вариант вступления.'}];assert.equal(api.authorRelations(s,['Марвин Бранаг']), '');npc.conflict={why:'EXPLICIT_DM_CONFLICT',source:'dm'};assert.ok(api.authorRelations(s,['Марвин Бранаг']).includes('EXPLICIT_DM_CONFLICT'));
 console.log('PASS: old/mild NPC conflicts and char pair conflict reach posts/comments; friendly voice does not cancel conflict; per-person scope; official/group isolation; reconciliation state; opening preview protection');
})().catch(e=>{console.error(e);process.exitCode=1;});
