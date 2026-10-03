const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={characterId:0,chatId:'a',name1:'Ариша',name2:'Леон',characters:[{}],chat:[],chatMetadata:{},extensionSettings:{cityhub:{backgroundDMs:false}},setExtensionPrompt(){}};
const env={console,Date,Math,JSON,Promise,Set,Map,WeakSet,WeakMap,SillyTavern:{getContext:()=>c},window:{addEventListener(){}},document:{getElementById(){return null;}},toastr:{info(){},success(){},warning(){},error(){}},jQuery(){},setTimeout(){},clearTimeout(){},setInterval(){}};
vm.createContext(env);
let source=fs.readFileSync(require('node:path').join(__dirname,'..','index.js'),'utf8').replace('    globalThis.CityHub = {',`globalThis.test={S,canonicalName,samePerson,personOf,personView,feedTab,lorePerson,openThread,reconcilePeople,looksLikeChar,scheduleDM,peopleIndex};mount=()=>{};render=()=>{};updateFab=()=>{};updateInjection=()=>{};globalThis.CityHub = {`);
vm.runInContext(source,env);const api=env.test,ui=env.CityHub._ui;
const post=(id,author)=>({id,author,text:'Пост '+id,t:10,likes:0,channel:'general',comments:[]});
let s=api.S();s.auth=true;
s.lorePeople=[{name:'Марвин Бранаг',role:'adult',bio:'Полицейский'},{name:'Клэр Редфилд',role:'adult',bio:'Друг'},{name:'Майкл',role:'adult',bio:'Житель'}];
s.feed=[post('1','Marvin Branagh'),post('2','Марвин Бранаг'),post('3','Claire Redfield'),post('4','Клэр'),post('5','Michael'),post('6','Майкл')];
s.feed[0].comments=[{id:'comment',author:'Claire',replyTo:'Marvin Branagh',replyToId:'parent',text:'@@Marvin Branagh Привет'}];
s.social.following=['Marvin Branagh','Марвин Бранаг','Claire'];
s.threads=[{id:'m-en',name:'Marvin Branagh',kind:'dm',t:10,rel:20,status:'знакомые',msgs:[{id:'a',text:'Первое',t:5}],unread:1,pendingReply:{id:'job',at:30,blockedScene:'old'}},{id:'m-ru',name:'Марвин Бранаг',kind:'dm',t:20,rel:40,status:'друзья',bio:'Коллега',sceneAnchor:{name:'Марвин Бранаг',evidence:'Марвин подошёл ко мне'},msgs:[{id:'b',text:'Второе',t:15},{id:'a',text:'Первое',t:5}],unread:2}];
s.meetings=[{id:'meet',with:'Marvin',threadId:'m-ru',status:'accepted'}];s.notes=[{id:'note',text:'Сообщение',go:{view:'thread',param:'m-ru'}}];s.strikes=[{letter:'m-ru'}];s.pendingDMs=[{from:'Marvin'}];s.stories=[{cast:['Marvin','Марвин Бранаг','Claire']}];
s.dating.matches=[{id:'d1',name:'Claire',bio:'Первое'},{id:'d2',name:'Клэр Редфилд',looks:'Внешность'}];s.dating.profiles=[];
ui.view='thread';ui.param='m-ru';api.S();
assert.deepEqual(Array.from(s.feed,p=>p.author),['Марвин Бранаг','Марвин Бранаг','Клэр Редфилд','Клэр Редфилд','Майкл','Майкл']);
assert.deepEqual(Array.from(s.feed,p=>p.id),['1','2','3','4','5','6']);
assert.equal(s.feed[0].comments[0].author,'Клэр Редфилд');assert.equal(s.feed[0].comments[0].replyTo,'Марвин Бранаг');assert.equal(s.feed[0].comments[0].replyToId,'parent');assert.equal(s.feed[0].comments[0].text,'Привет');
assert.deepEqual(Array.from(s.social.following),['Марвин Бранаг','Клэр Редфилд']);
assert.equal(s.threads.length,1);const th=s.threads[0];assert.equal(th.id,'m-en');assert.equal(th.name,'Марвин Бранаг');assert.equal(th.rel,40);assert.equal(th.unread,3);assert.deepEqual(Array.from(th.msgs,m=>m.id),['a','b']);assert.equal(th.identityHistory[0].rel,20);assert.equal(th.identityHistory[1].rel,40);assert.equal(th.pendingReply.id,'job');assert.equal(th.pendingReply.blockedScene,undefined);assert.equal(th.sceneAnchor.name,th.name);
assert.equal(s.meetings[0].threadId,th.id);assert.equal(s.meetings[0].with,th.name);assert.equal(s.notes[0].go.param,th.id);assert.equal(s.strikes[0].letter,th.id);assert.equal(ui.param,th.id);assert.equal(s.pendingDMs[0].from,th.name);
assert.deepEqual(Array.from(s.stories[0].cast),['Марвин Бранаг','Клэр Редфилд']);assert.equal(s.dating.matches.length,1);assert.equal(s.dating.matches[0].looks,'Внешность');
const before=JSON.stringify(s);api.S();api.S();assert.equal(JSON.stringify(s),before,'migration is idempotent');
assert.equal(api.canonicalName(s,'Claire Redfield'),'Клэр Редфилд');assert.equal(api.lorePerson(s,'Marvin').name,'Марвин Бранаг');
assert.equal(api.openThread(s,'Marvin').id,th.id);assert.equal(s.threads.length,1);
ui.channel='following';assert.ok(api.feedTab(s).includes('Пост 1'));assert.ok(api.feedTab(s).includes('Пост 3'));assert.equal((api.feedTab(s).match(/class="sh-story" data-act="person"/g)||[]).length,3);
assert.ok(api.personView(s,'Marvin Branagh').includes('Пост 2'));assert.equal(api.personOf(s,'Marvin').following,true);
// Canonical names stay stable even if the newest post changes language.
s.feed.unshift(post('new','Marvin Branagh'));api.S();assert.equal(s.feed[0].author,'Марвин Бранаг');
// Homonyms with different surnames stay distinct; an ambiguous short name is not assigned.
s.lorePeople.push({name:'Марвин Смит',role:'adult',bio:'Другой человек'});s.feed.push(post('homonym','Marvin Smith'),post('short','Marvin'));api.S();
assert.equal(api.samePerson(s,'Marvin Branagh','Marvin Smith'),false);assert.equal(api.lorePerson(s,'Marvin'),undefined);assert.equal(s.feed.find(p=>p.id==='short').author,'Marvin');
const html=api.feedTab(s);assert.ok(html.includes('<small>Марвин Бранаг</small>'));assert.ok(html.includes('<small>Марвин Смит</small>'));
// Source aliases support irregular translations not in the local spelling rules.
s.lorePeople.push({name:'Роберт Кендо',role:'adult',aliases:['Robert Kendo','Bob Kendo']});s.feed.push(post('bob','Bob Kendo'));api.S();assert.equal(s.feed.at(-1).author,'Роберт Кендо');
// Groups/departments are not personal profiles, even if a person has the same name.
s.threads.push({id:'group',name:'Марвин Бранаг',kind:'group',msgs:[]},{id:'office',name:'Марвин Бранаг',kind:'official',msgs:[]});api.S();assert.equal(api.openThread(s,'Marvin Branagh').id,th.id);assert.equal(api.openThread(s,'Марвин Бранаг','','','group').id,'group');assert.equal(s.threads.length,3);
// An NPC mentioned in the card is not automatically the main character.
c.characters[0].description='Леон знает Марвина';assert.equal(api.looksLikeChar('Марвин Бранаг'),false);assert.equal(api.looksLikeChar('Leon'),true);
// Main character thread wins; pending reply and both message histories survive.
s.threads.push({id:'leon-dm',name:'Leon',kind:'dm',msgs:[{id:'ld',text:'DM',t:1}],t:1},{id:'leon-char',name:'Леон',kind:'char',msgs:[{id:'lc',text:'CHAR',t:2}],t:2,pair:true});api.S();const leon=s.threads.find(t=>t.kind==='char');assert.equal(leon.id,'leon-char');assert.equal(leon.msgs.length,2);assert.equal(leon.pair,true);assert.ok(!s.threads.find(t=>t.id==='leon-dm'));
// Busy generators are not removed from underneath their pending callbacks.
s.threads.push({id:'late',name:'Marvin Branagh',kind:'dm',typing:true,msgs:[{id:'late-msg',text:'In flight',t:99}]});api.S();assert.ok(s.threads.some(t=>t.id==='late'));s.threads.find(t=>t.id==='late').typing=false;api.S();assert.ok(!s.threads.some(t=>t.id==='late'));assert.equal(th.msgs.at(-1).id,'late-msg');
// Every chat has a separate alias registry.
c.chatId='b';c.chatMetadata={};const other=api.S();assert.equal(api.canonicalName(other,'Marvin'),'Marvin');assert.equal(other.feed.length,0);
const shortThread=api.openThread(other,'Michael');const fullThread=api.openThread(other,'Michael Jones');assert.equal(shortThread,fullThread);assert.equal(fullThread.name,'Michael Jones');fullThread.msgs.push({text:'Не потерять',t:1});api.S();assert.equal(other.threads.length,1);assert.equal(other.threads[0].msgs.length,1);other.profile.name='Майкл';assert.equal(api.samePerson(other,'Майкл','Michael Jones'),false);
console.log('PASS: screenshot names; full/short spelling; aliases; homonyms; stable names; lossless posts/comments/DMs; subscriptions; routes; character/group isolation; busy jobs; per-chat migration');
