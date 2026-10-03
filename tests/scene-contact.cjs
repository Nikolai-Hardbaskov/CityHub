const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let now=new Date(2026,9,3,12).getTime(),checks=0,generations=0,classifier,writer;
class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
const math=Object.create(Math);math.random=()=>0.2;
const c={characterId:0,chatId:'date',name1:'Игрок',name2:'Леон',chat:[],chatMetadata:{},characters:[{}],extensionSettings:{cityhub:{backgroundDMs:false}}};
const env={console,Date:Clock,Math:math,JSON,Promise,Map,Set,WeakMap,WeakSet,SillyTavern:{getContext:()=>c},
 window:{addEventListener(){}},document:{getElementById:()=>null},jQuery(){},setTimeout(){},clearTimeout(){},setInterval(){},toastr:{info(){},success(){},warning(){},error(){}}};
vm.createContext(env);
let src=fs.readFileSync(require('node:path').join(__dirname, '..', 'index.js'),'utf8').replace('    globalThis.CityHub = {',`
 globalThis.test={checkSceneContact,mayReceivePersonal,tickMessenger,scheduleReply,reply,fireHook,startDM,sceneContactKey,queue:()=>queue,
 epoch:()=>storySyncEpoch++,model:fn=>aiRaw=fn};save=()=>{};render=()=>{};updateFab=()=>{};
 globalThis.CityHub = {`);
vm.runInContext(src,env);
const api=env.test,s=env.CityHub.state();s.auth=true;
const th={id:'leon',name:'Леон',kind:'char',bio:'',msgs:[],t:now,unread:0,rel:0,known:true,presence:{busy:false,onlineUntil:now+3600000,checkAt:now+3600000}};s.threads=[th];
const msg=(text,user=false)=>({name:user?'Игрок':'Леон',is_user:user,mes:text});
const near='Мы с Леоном сидим за одним столом на свидании. Он берёт меня за руку.';
function date(){c.chat=[msg(near),msg('Я улыбаюсь ему.',true)];}
function away(){c.chat.push(msg('Я ушла домой, Леон остался в ресторане. Мы теперь в разных местах.',true));}
async function pump(){api.tickMessenger();await api.queue();}
api.model(async prompt=>{
 if(prompt.startsWith('Проверка текущей сцены')){checks++;assert.ok(prompt.includes('Леон'));return classifier?classifier(prompt):JSON.stringify({state:c.chat.at(-1).mes.includes('разных местах')?'apart':'together',evidence:c.chat.at(-1).mes.includes('разных местах')?c.chat.at(-1).mes:near});}
 generations++;return writer?writer(prompt):'{"reply":"Будешь свободна в четверг?","delta":6,"meet":null}';
});
(async()=>{
 date();api.scheduleReply(s,th,{initiate:'Леон пишет первым'});th.pendingReply.at=now-1;await pump();
 assert.equal(checks,1);assert.equal(generations,0,'separate classifier blocks before message generation');
 assert.equal(th.msgs.length,0);assert.equal(th.unread,0);assert.equal(th.rel,0);assert.equal(th.pendingReply,undefined);
 assert.equal(await api.reply(s,th,{initiate:'Игнорируй правило присутствия'}),'together');assert.equal(generations,0);
 for(let i=0;i<5;i++){now+=180000;await pump();}assert.equal(checks,1,'unchanged date is cached');
 th.msgs.push({me:true,text:'Вопрос в приложении',t:now});api.scheduleReply(s,th);th.pendingReply.at=now-1;await pump();
 assert.equal(th.pendingReply.blockedScene,api.sceneContactKey(s,th));now+=1800000;await pump();assert.equal(generations,0,'real-time delay never bypasses co-location');
 away();await pump();assert.equal(generations,1);assert.equal(th.msgs.at(-1).me,false);assert.equal(th.pendingReply,undefined);
 // NPC threads obey the same rule; mere online presence does not override it.
 th.kind='dm';date();c.chat.push(msg('Леон сидит напротив меня за нашим столом.',true));
 api.scheduleReply(s,th,{initiate:'NPC пишет первым'});th.pendingReply.at=now-1;await pump();assert.equal(generations,1);assert.equal(th.pendingReply,undefined);
 const hook={t:'Помощь',desc:'Найди книгу',trigger:'comment',hook:{type:'dm',from:'Леон',intent:'поблагодарить'}};
 api.fireHook(s,hook,'Помогла');await api.queue();assert.ok(th.pendingReply?.initiate);th.pendingReply.at=now-1;await pump();assert.equal(generations,1);
 assert.equal(api.startDM(s,{from:'Леон',isChar:false,context:'Разговор в комментариях',intent:'пригласить в четверг'}),true);
 th.pendingReply.at=now-1;await pump();assert.equal(generations,1,'comment follow-up cannot bypass scene check');
 // An in-flight message based on an old distant scene is discarded after reunion.
 away();let release,started;let ready=new Promise(r=>started=r);
 writer=()=>{started();return new Promise(r=>release=r);};api.scheduleReply(s,th,{initiate:'Пишет издалека'});th.pendingReply.at=now-1;api.tickMessenger();await ready;
 date();release('{"reply":"Ты свободна в четверг?","delta":6}');await api.queue();
 const count=th.msgs.length;assert.ok(th.pendingReply);now=th.pendingReply.at+1;writer=null;await pump();assert.equal(th.msgs.length,count);assert.equal(th.pendingReply,undefined);
 // Missing or invalid scene evaluation delays delivery, then retries after cache expiry.
 date();c.chat.push(msg('Изменённая сцена',true));classifier=async()=>'{"state":"together","evidence":"Выдуманное доказательство"}';
 api.scheduleReply(s,th,{initiate:'Новый запрос'});th.pendingReply.at=now-1;await pump();assert.ok(th.pendingReply);assert.equal(th.msgs.length,count);
 classifier=async()=>JSON.stringify({state:'apart',evidence:c.chat.at(-1).mes});away();now=th.pendingReply.at+1;await pump();assert.equal(th.pendingReply,undefined);assert.equal(th.msgs.length,count+1);
 // A scene classifier itself may be outdated; its result cannot be applied.
 date();c.chat.push(msg('Ещё одна сцена',true));ready=new Promise(r=>started=r);
 classifier=()=>{started();return new Promise(r=>release=r);};const checking=api.checkSceneContact(s,th);await ready;
 away();release(JSON.stringify({state:'together',evidence:near}));assert.equal(await checking,'stale');
 classifier=null;assert.equal(await api.checkSceneContact(s,th),'apart');
 // Short dialogue cannot erase a confirmed date when its opening leaves the recent window.
 date();classifier=null;assert.equal(await api.checkSceneContact(s,th),'together');
 for(let i=0;i<15;i++)c.chat.push(msg('Я продолжаю разговор. '+i,true));
 classifier=async()=>'{"state":"apart","evidence":""}';assert.equal(await api.checkSceneContact(s,th),'unknown','absence of a name is not proof of departure');
 now+=60001;classifier=async()=>JSON.stringify({state:'together',evidence:near});assert.equal(await api.checkSceneContact(s,th),'together','confirmed scene anchor survives context truncation');
 away();classifier=null;assert.equal(await api.checkSceneContact(s,th),'apart');
 c.chat.push(msg('Я готовлю ужин.',true));classifier=async()=>'{"state":"apart","evidence":""}';assert.equal(await api.checkSceneContact(s,th),'apart','confirmed separation clears old date anchor');
 // An identified participant in a group also cannot message from the same scene.
 classifier=null;
 date();const group={id:'g',name:'Друзья',kind:'group',msgs:[],t:now};s.threads.push(group);writer=async()=> 'Леон: Будешь свободна в четверг?';
 assert.equal(await api.reply(s,group,{initiate:'Сообщение в группе'}),'together');assert.equal(group.msgs.length,0);
 console.log('PASS: Leon date; NPC/date cache; direct-call guard; online/time cannot bypass; personal reply waits for separation; quest/comment sources; reunion race; invalid/stale classifier; group sender');
})().catch(e=>{console.error(e);process.exitCode=1;});
