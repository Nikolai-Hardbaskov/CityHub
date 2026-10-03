const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const c={characterId:0,chatId:'full-card',name1:'Ариша',name2:'Леон',characters:[],chat:[],chatMetadata:{},extensionSettings:{cityhub:{}},setExtensionPrompt(){}};
const env={console,Date,Math,JSON,Promise,Map,Set,WeakMap,WeakSet,SillyTavern:{getContext:()=>c},window:{addEventListener(){}},document:{getElementById:()=>null},jQuery(){},toastr:{info(){},success(){},warning(){},error(){}},setTimeout(){},clearTimeout(){},setInterval(){}};
vm.createContext(env);
const source=fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8').replace('    globalThis.CityHub = {',`globalThis.test={charCard,charInfo,world,syncRel,checkSceneContact,reply,extractLorePeople,model:fn=>aiRaw=fn};save=()=>{};render=()=>{};globalThis.CityHub = {`);
vm.runInContext(source,env);const api=env.test;
const fields={description:'Описание. '.repeat(1200)+'DESCRIPTION_END: {{user}} is his girlfriend. Друг: Марвин Бранаг.',personality:'Характер. '.repeat(900)+'PERSONALITY_END: {{char}}',scenario:'Сценарий. '.repeat(800)+'SCENARIO_END: {{user}}',mes_example:'<START>\nРечь. '.repeat(700)+'EXAMPLES_END: {{char}}',first_mes:'Вступление. '.repeat(700)+'FIRST_MESSAGE_END: {{user}}'};
function check(prompt,examples=true){for(const marker of ['DESCRIPTION_END: Ариша','PERSONALITY_END: Леон','SCENARIO_END: Ариша',...(examples?['EXAMPLES_END: Леон']:[])])assert.ok(prompt.includes(marker),'missing '+marker);}
(async()=>{
 for(const v2 of [false,true]){
  c.chatId+='x';c.chatMetadata={};c.characters=[v2?{data:{...fields}}:{...fields}];c.chat=[{name:'Леон',mes:'Леон ушёл на работу.',is_user:false},{name:'Ариша',mes:'Я осталась дома.',is_user:true}];
  const s=env.CityHub.state();s.auth=true;const th={id:'char',name:'Леон',kind:'char',msgs:[],rel:0};s.threads=[th];
  check(api.charCard());assert.ok(!api.charCard().includes('<START>'));check(api.charInfo(),false);check(api.world(s),false);
  let relationshipPrompt;
  api.model(async p=>{relationshipPrompt=p;return JSON.stringify({known:true,pair:true,rel:50,status:'пара',note:'По карточке'});});
  await api.syncRel(s,th);check(relationshipPrompt);assert.ok(relationshipPrompt.includes('FIRST_MESSAGE_END: Ариша'));assert.equal(th.pair,true);
  let scenePrompt;
  api.model(async p=>{scenePrompt=p;return '{"state":"apart","evidence":""}';});assert.equal(await api.checkSceneContact(s,th),'apart');check(scenePrompt);
  let replyPrompt;
  api.model(async p=>{replyPrompt=p;return '{"reply":"Привет!","delta":0}';});assert.equal(await api.reply(s,th),'delivered');check(replyPrompt);assert.ok(th.msgs.some(m=>m.text==='Привет!'));
  let peoplePrompt;
  api.model(async p=>{peoplePrompt=p;return '[{"name":"Марвин Бранаг","role":"adult"}]';});assert.equal(await api.extractLorePeople(s),1);check(peoplePrompt);assert.equal(s.lorePeople[0].name,'Марвин Бранаг');
 }
 console.log('PASS: full legacy/v2 card tails reach world, relationships, scene guard, DM reply and resident extraction; full opening; macros and speech examples');
})().catch(e=>{console.error(e);process.exitCode=1;});
