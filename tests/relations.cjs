const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const c={characterId:0,chatId:'relations',name1:'Игрок',name2:'Персонаж',chat:[],
 chatMetadata:{},characters:[{first_mes:''}],extensionSettings:{cityhub:{}}};
const env={console,Date,Math,JSON,Promise,Map,Set,WeakMap,WeakSet,
 SillyTavern:{getContext:()=>c},window:{addEventListener(){}},document:{getElementById:()=>null},
 jQuery(){},setTimeout(){},clearTimeout(){},setInterval(){}};
vm.createContext(env);
let src=fs.readFileSync(require('node:path').join(__dirname, '..', 'index.js'),'utf8').replace('    globalThis.CityHub = {',`
 globalThis.test={syncRel,model:fn=>aiJSON=fn}; save=()=>{};render=()=>{};
 globalThis.CityHub = {`);
vm.runInContext(src,env);
const s=env.CityHub.state();s.auth=true;
const th={kind:'char',name:'Персонаж',msgs:[],rel:0};s.threads=[th];
const msg=(mes,is_user=false)=>({name:is_user?'Игрок':'Персонаж',mes,is_user});
const api=env.test;
const response=(rel,status,note,pair=false)=>({known:true,rel,status,note,pair});
let prompt;
const evaluate=async r=>{api.model(async p=>{prompt=p;return r;});await api.syncRel(s,th);};
(async()=>{
 c.chat=[msg('Напиши вступление',true),msg('Отвергнутый вариант: персонажи поссорились')];
 await evaluate(response(-70,'вражда','Отвергнутая ссора'));
 assert.equal(th.conflict,undefined);assert.equal(th.reconciled,undefined);
 assert.equal(th.relStoryAccepted,false);assert.ok(!env.CityHub._inj().includes('Отвергнутая ссора'));
 const notes=s.notes.length;
 c.chat[1].mes='Другой вариант: персонажи влюблены';
 await evaluate(response(90,'пара','Отвергнутая пара',true));
 assert.equal(s.profile.relWithChar,false);assert.equal(s.notes.length,notes);
 // Migrate a conflict created from a first-message candidate by an older version.
 delete th.relStoryAccepted;th.conflict={why:'Ссора из старого вступления',t:Date.now(),low:-70};
 c.chat[1].mes='Выбранное вступление: дружеское знакомство';
 c.chat.push(msg('Здороваюсь с новым знакомым',true));
 await evaluate(response(25,'знакомые','Выбранное знакомство'));
 assert.ok(prompt.includes('Выбранное вступление'));assert.ok(!prompt.includes('Отвергнутый вариант'));
 assert.equal(th.conflict,null);assert.equal(th.reconciled,null);
 assert.equal(th.relNote,'Выбранное знакомство');assert.equal(th.relStoryAccepted,true);
 assert.ok(!env.CityHub._inj().includes('Недавно помирились'));
 c.chat.push(msg('Они действительно поссорились из-за книги'));
 await evaluate(response(-50,'ссора','Спор о книге'));assert.equal(th.conflict.why,'Спор о книге');
 c.chat.at(-1).mes='Ссора произошла из-за опоздания';
 await evaluate(response(-50,'ссора','Опоздание'));assert.equal(th.conflict.why,'Опоздание');
 c.chat.push(msg('Они извинились и помирились'));
 await evaluate({...response(40,'друзья','Помирились'),conflictChange:{state:'resolved',source:'story',evidence:'Они извинились и помирились'}});
 assert.equal(th.conflict,null);assert.equal(th.reconciled.why,'Опоздание');
 // Explicit messenger conflict survives an unaccepted opening evaluation.
 c.chat=[msg('Ещё один вариант вступления')];
 th.conflict={why:'Настоящий спор в переписке',source:'dm',t:Date.now(),low:-50};
 await evaluate(response(-60,'ссора','Предварительный вывод'));
 assert.equal(th.conflict.why,'Настоящий спор в переписке');
 c.chat.push(msg('Продолжаю выбранное вступление',true));
 await evaluate(response(-60,'ссора','Настоящий спор в переписке'));
 assert.equal(th.conflict.why,'Настоящий спор в переписке');
 // Outdated relation evaluation must never overwrite the accepted current scene.
 let release,started;const waiting=new Promise(r=>started=r);
 api.model(()=>{started();return new Promise(r=>release=r);});
 const pending=api.syncRel(s,th);await waiting;
 c.chat.push(msg('Новая сцена'));
 release(response(100,'пара','Устаревший ответ',true));await pending;
 assert.notEqual(th.relNote,'Устаревший ответ');assert.equal(th.relSyncing,false);
 console.log('PASS: opening conflict/pair previews; legacy cleanup; current conflict reason; real reconciliation; explicit DM; stale result');
})().catch(e=>{console.error(e);process.exitCode=1;});
