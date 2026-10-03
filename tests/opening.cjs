const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const c = {characterId:0, chatId:'opening', name1:'Игрок', name2:'Персонаж', chat:[],
  chatMetadata:{}, characters:[{first_mes:''}], extensionSettings:{cityhub:{inject:true}}};
const env = {console, Date, Math, JSON, Promise, Map, Set, WeakMap, WeakSet,
  SillyTavern:{getContext:()=>c}, window:{addEventListener(){}},
  document:{getElementById:()=>null}, jQuery(){}, setTimeout(){}, clearTimeout(){}, setInterval(){}};
vm.createContext(env);
let source=fs.readFileSync(require('node:path').join(__dirname, '..', 'index.js'),'utf8');
source=source.replace('    globalThis.CityHub = {', `
    globalThis.test = { hasStoryProgress, refreshQuests, dailyQuestsHTML, scanCrimes, queue:()=>queue,
      busy:v=>mainGenerating=v, nextChat:()=>storySyncEpoch++, model:fn=>aiJSON=fn, day:()=>dkey(NOW()) };
    save=()=>{}; render=()=>{};
    globalThis.CityHub = {`);
vm.runInContext(source,env);
const api=env.test, s=env.CityHub.state(); s.auth=true; s.profile.profession='Врач';
let calls=0;
const quests=[{k:'rp',title:'Выбранная сцена',desc:'Новая задача',hook:null},
 {k:'like',title:'Лайки',n:2},{k:'follow',title:'Подписки',n:2}];
api.model(async()=>{calls++;return quests;});
const msg=(text,user=false)=>({name:user?'Игрок':'Персонаж',is_user:user,mes:text});
const inj=()=>env.CityHub._inj();
(async()=>{
  assert.equal(api.hasStoryProgress(),false);
  assert.equal(api.refreshQuests(s),false); await api.queue(); assert.equal(calls,0);
  c.chat=[msg('Напиши первое сообщение',true),{is_system:true,mes:'Контекст'},msg('')];
  assert.equal(api.refreshQuests(s),false);
  c.chat.push(msg('<think>План</think><horae>time: 12:00</horae>'));
  assert.equal(api.hasStoryProgress(),false,'service tags cannot establish story');
  c.chat.pop(); c.chat.push(msg('Первый вариант: встреча в библиотеке'));
  s.social.quests=[{k:'rp',t:'OLD_QUEST',desc:'OLD_DESC',setup:'OLD_SCENE',done:false}];
  s.social.questDay=api.day();
  s.notes=[{type:'important',text:'OLD_NOTE',t:Date.now()}];
  s.threads=[{kind:'char',name:'Персонаж',msgs:[],status:'OLD_REL',rel:80,relNote:'OLD_REASON'}];
  const opening=inj();
  for(const x of ['OLD_QUEST','OLD_SCENE','OLD_NOTE','OLD_REL','Время истории','Популярность'])
    assert.ok(!opening.includes(x),'opening excludes '+x);
  for(let i=0;i<4;i++){
    c.chat.at(-1).mes='Другой вариант вступления '+i; c.chat.at(-1).swipe_id=i;
    assert.equal(api.hasStoryProgress(),false);
    assert.equal(api.refreshQuests(s),false);
    assert.equal(inj(),opening,'rerolls get no previous opening anchors');
  }
  assert.equal(calls,0);
  assert.ok(!api.dailyQuestsHTML(s).includes('OLD_QUEST'));
  assert.ok(api.dailyQuestsHTML(s).includes('выбранное вступление'));
  await api.scanCrimes(s);
  assert.equal(s.crimeScanAt,undefined,'opening variants do not trigger crime scan');
  s.threads.push({kind:'dm',name:'Сосед',msgs:[{me:true,text:'MANUAL_DM',t:Date.now()}]});
  assert.ok(inj().includes('MANUAL_DM'),'explicit app conversation preserved');
  c.chat.push(msg('Я вхожу в комнату и здороваюсь.',true));
  assert.equal(api.hasStoryProgress(),true);
  api.busy(true); assert.equal(api.refreshQuests(s),false); assert.equal(calls,0);
  api.busy(false); assert.equal(api.refreshQuests(s),true); await api.queue();
  assert.equal(calls,1); assert.equal(s.social.quests.length,3);
  assert.equal(s.social.questsPendingOpening,false);
  assert.ok(!s.social.quests.some(q=>q.t==='OLD_QUEST'),'legacy quests replaced');
  assert.ok(inj().includes('Выбранная сцена'),'normal quests restored after user reply');
  assert.equal(api.refreshQuests(s),false); await api.queue(); assert.equal(calls,1);
  // A delayed model answer from an abandoned scene must be discarded.
  let release,started; const waiting=new Promise(r=>started=r);
  api.model(()=>{started();return new Promise(r=>release=r);});
  s.social.questDay=''; assert.equal(api.refreshQuests(s),true); await waiting;
  c.chat.pop(); c.chat.at(-1).mes='Перегенерированное вступление';
  release(quests); await api.queue();
  assert.equal(s.social.quests.length,0); assert.equal(s.social.questsLoading,false);
  assert.equal(s.social.questDay,''); assert.equal(api.hasStoryProgress(),false);
  // Leaving and returning to the same chat invalidates even identical story text.
  c.chat.push(msg('Продолжаю выбранную сцену',true));
  s.social.questDay='';
  let begun; const ready=new Promise(r=>begun=r);
  api.model(()=>{begun();return new Promise(r=>release=r);});
  assert.equal(api.refreshQuests(s),true); await ready;
  api.nextChat(); release(quests); await api.queue();
  assert.equal(s.social.quests.length,0); assert.equal(s.social.questDay,'');
  // Normal established-story crime scanning still runs; old scene results cannot apply.
  calls=0; api.model(async()=>{calls++;return {offense:false};});
  await api.scanCrimes(s); await api.scanCrimes(s); await api.scanCrimes(s);
  assert.equal(calls,1); assert.equal(s.crimeScanAt,3);
  console.log('PASS: blank opener, opening swipes, legacy anchors, manual DM, deferred quests, normal story, stale generation');
})().catch(e=>{console.error(e);process.exitCode=1;});

