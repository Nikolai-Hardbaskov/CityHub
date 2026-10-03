const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let now=new Date(2026,9,2,12).getTime(),random=0.2,calls=0,handler;
class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
const math=Object.create(Math);math.random=()=>random;
const input={value:'',focus(){}},events=new Map(),intervals=[];
const names=['CHAT_CHANGED','MESSAGE_RECEIVED','MESSAGE_SENT','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_DELETED','MESSAGE_SWIPED','USER_MESSAGE_RENDERED','CHARACTER_MESSAGE_RENDERED','CHARACTER_EDITED','PERSONA_CHANGED','GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED'];
const c={characterId:0,chatId:'a',name1:'Игрок',name2:'Персонаж',chat:[{name:'Персонаж',mes:'Он в своём доме',is_user:false},{name:'Игрок',mes:'Я возвращаюсь домой',is_user:true}],
 chatMetadata:{},characters:[{}],extensionSettings:{cityhub:{backgroundDMs:false,syncAI:false,syncHorae:false}},
 event_types:Object.fromEntries(names.map(n=>[n,n])),eventSource:{on:(n,fn)=>events.set(n,fn)},setExtensionPrompt(){}};
const env={console,Date:Clock,Math:math,JSON,Promise,Set,Map,WeakSet,WeakMap,
 SillyTavern:{getContext:()=>c},window:{addEventListener(){}},document:{getElementById:id=>id==='sh-msg'?input:null},
 toastr:{info(){},success(){},warning(){},error(){}},jQuery(){},setTimeout(){},clearTimeout(){},setInterval:fn=>intervals.push(fn)};
vm.createContext(env);
let source=fs.readFileSync(require('node:path').join(__dirname, '..', 'index.js'),'utf8').replace('    globalThis.CityHub = {',`
 globalThis.test={init,tickMessenger,scheduleReply,contactOnline,updateContactAvailability,presenceHTML,chatsTab,threadView,onChatChanged,queue:()=>queue,
 busy:v=>mainGenerating=v,model:fn=>aiRaw=fn,enqueue};
 mount=()=>{};checkFab=()=>{};tick=()=>{};render=()=>{};updateFab=()=>{};save=()=>{};
 globalThis.CityHub = {`);
vm.runInContext(source,env);
const api=env.test,s=env.CityHub.state();s.auth=true;s.clock.t=now;s.campusLoreAt=s.genClubsAt=s.lorePeopleAt=now;s.lorePeopleVersion=3;
const th={id:'person',name:'Персонаж',kind:'char',bio:'',msgs:[],t:now,rel:0,known:true,unread:0};s.threads=[th];
function online(){th.presence={onlineUntil:now+600000,checkAt:now+600000,busy:false,busyUntil:0,reason:''};}
function offline(){th.presence={onlineUntil:0,checkAt:now+600000,busy:false,busyUntil:0,reason:''};}
function send(text){input.value=text;env.CityHub._act.send({id:th.id},null,s);}
async function pump(){api.tickMessenger();await api.queue();}
function advance(ms){now+=ms;}
api.model(async prompt=>{if(prompt.startsWith('Проверка текущей сцены'))return '{"state":"apart","evidence":""}';calls++;return handler?handler(prompt):'{"reply":"Новое сообщение","delta":1,"flirt":false,"meet":null}';});
(async()=>{
 api.init();assert.ok(intervals.length>=3,'messenger timer installed separately from visible-window refresh');
 online();send('Привет');assert.equal(calls,0);assert.ok(th.pendingReply);assert.ok(!th.typing);
 assert.ok(th.pendingReply.at-now<=5000);await pump();assert.equal(calls,0);
 advance(6000);await pump();assert.equal(calls,1);assert.equal(th.unread,1);assert.equal(th.pendingReply,undefined);
 assert.equal(th.msgs.at(-1).me,false);assert.equal(env.CityHub._ui.open,false);assert.equal(api.contactOnline(s,th),true);
 assert.ok(api.chatsTab(s).includes('sh-presence online'));assert.ok(api.threadView(s,th.id).includes('Онлайн'));
 offline();random=0.8;send('Ответь, когда сможешь');const due=th.pendingReply.at;
 assert.ok(due-now>=120000&&due-now<=300000);await pump();assert.equal(calls,1);
 now=due+1;api.tickMessenger();api.tickMessenger();await api.queue();assert.equal(calls,2,'duplicate ticks cannot duplicate delivery');
 offline();random=0.3;api.updateContactAvailability(s,th,{busy:true,reason:'работает',until:null});
 assert.equal(api.contactOnline(s,th),false);send('Напиши после работы');const waiting=th.pendingReply;assert.equal(waiting.waitForFree,true);
 now=waiting.at+1;await pump();assert.equal(calls,2,'busy contact waits for free story time');
 s.clock.t=th.presence.busyUntil+1;await pump();assert.equal(calls,3);assert.equal(th.presence.busy,false);
 offline();random=0.8;api.updateContactAvailability(s,th,{busy:true,reason:'занят',until:null});send('Можно коротко ответить?');
 assert.equal(th.pendingReply.waitForFree,false);now=th.pendingReply.at+1;await pump();assert.equal(calls,4);assert.equal(th.presence.busy,true);assert.equal(api.contactOnline(s,th),true,'brief login overrides busy offline indicator');
 offline();random=0.2;send('После главного ответа');now=th.pendingReply.at+1;api.busy(true);await pump();assert.equal(calls,4);api.busy(false);await pump();assert.equal(calls,5);
 // New user text while a reply is generating must invalidate that reply and remain queued.
 online();let release,started;let ready=new Promise(r=>started=r);
 handler=()=>{started();return new Promise(r=>release=r);};send('Первое сообщение');now=th.pendingReply.at+1;api.tickMessenger();await ready;
 assert.equal(th.typing,true);send('Дописываю второе сообщение');const replacement=th.pendingReply;
 release('{"reply":"Устаревший ответ","delta":0}');await api.queue();assert.equal(th.pendingReply,replacement);assert.ok(!th.msgs.some(m=>m.text==='Устаревший ответ'));
 handler=null;now=replacement.at+1;await pump();assert.equal(th.pendingReply,undefined);
 // Persisted queue survives reload (JSON metadata) and changing chats during generation.
 offline();send('Сохранённое ожидание');const a=c.chatMetadata;const saved=JSON.parse(JSON.stringify(s));
 c.chatMetadata={cityhub:saved};api.onChatChanged();assert.equal(env.CityHub.state().threads[0].pendingReply.id,saved.threads[0].pendingReply.id);
 c.chatMetadata=a;api.onChatChanged();online();now=th.pendingReply.at+1;
 ready=new Promise(r=>started=r);handler=()=>{started();return new Promise(r=>release=r);};api.tickMessenger();await ready;
 const before=th.msgs.length;c.chatMetadata={};c.chatId='b';c.chat=[{name:'Персонаж',mes:'Другая сцена',is_user:false}];api.onChatChanged();
 release('{"reply":"Ответ из другого чата","delta":0}');await api.queue();assert.equal(th.msgs.length,before);assert.ok(th.pendingReply);
 c.chatMetadata=a;c.chatId='a';c.chat=[{name:'Персонаж',mes:'Он дома',is_user:false},{name:'Игрок',mes:'Продолжение',is_user:true}];api.onChatChanged();handler=null;await pump();assert.equal(th.pendingReply,undefined);
 // A task skipped before its callback starts must release the thread's queue lock.
 let unblock;const blocked=api.enqueue(s,()=>new Promise(r=>unblock=r));await Promise.resolve();
 online();send('Жду очередь');now=th.pendingReply.at+1;api.tickMessenger();
 c.chatMetadata={};c.chatId='skip';api.onChatChanged();unblock();await blocked;await api.queue();
 c.chatMetadata=a;c.chatId='a';api.onChatChanged();await pump();assert.equal(th.pendingReply,undefined,'skipped queued task must be runnable after return');
 // Characters initiate while CityHub is closed, with cooldown and unread protection.
 c.extensionSettings.cityhub.backgroundDMs=true;th.unread=0;th.lastInitiatedAt=0;th.lastIncomingAt=0;th.msgs=[];online();s.nextIncomingAt=now-1;
 const relation=th.rel;await pump();assert.ok(th.pendingReply?.initiate);now=th.pendingReply.at+1;await pump();assert.equal(th.unread,1);assert.equal(th.rel,relation,'initiative does not re-score an old user message');
 s.nextIncomingAt=now-1;await pump();assert.equal(th.pendingReply,undefined,'unread incoming blocks another initiative');
 // Before the opening is accepted, unsolicited messages do not pin it.
 c.chat=[{name:'Персонаж',mes:'Вариант вступления',is_user:false}];th.unread=0;s.nextIncomingAt=now-1;await pump();assert.equal(th.pendingReply,undefined);assert.equal(s.nextIncomingAt,0);
 assert.ok(api.presenceHTML(s,th).includes('aria-label='));
 console.log('PASS: closed-window messages; online/offline delays; busy wait and brief visit; generation guard; dedup; newer message; persisted queue; chat switch; initiatives; cooldown/unread; opening protection; presence markup');
})().catch(e=>{console.error(e);process.exitCode=1;});
