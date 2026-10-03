const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let model,calls=0,prompts=[];
const c={characterId:0,chatId:'first',name1:'Ариша',name2:'Леон',characters:[{}],chat:[],chatMetadata:{},extensionSettings:{cityhub:{backgroundDMs:false,syncAI:false,syncHorae:false}},setExtensionPrompt(){}};
const env={console,Date,Math,JSON,Promise,Set,Map,WeakSet,WeakMap,SillyTavern:{getContext:()=>c},window:{addEventListener(){}},document:{getElementById(){return null;}},toastr:{info(){},success(){},warning(){},error(){}},jQuery(){},setTimeout(){},clearTimeout(){},setInterval(){}};
vm.createContext(env);
let source=fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8').replace('    globalThis.CityHub = {',`globalThis.test={S,extractLorePeople,canonicalName,samePerson,looksLikeChar,onChatChanged,queue:()=>queue,model:fn=>aiRaw=fn};mount=()=>{};render=()=>{};updateFab=()=>{};updateInjection=()=>{};tick=()=>{};globalThis.CityHub = {`);
vm.runInContext(source,env);const api=env.test;
api.model(async prompt=>{calls++;prompts.push(prompt);return model(prompt);});
function chat(name,description,lore){c.name2=name;c.chatId+='x';c.chatMetadata={};c.characters=[{description,data:{character_book:{entries:[{keys:[],content:lore}]}}}];const s=api.S();s.auth=true;s.campusLoreAt=s.genClubsAt=1;return s;}
function posts(s,names){s.feed=names.map((author,i)=>({id:'p'+i,author,text:'Публикация '+i,t:i,channel:'general',comments:[]}));}
(async()=>{
 // Legacy scans omitted {{char}} entirely. Refresh once to recover a sourced surname.
 const s=chat('Леон','Леон — полицейский.','Леон Кеннеди — полицейский, главный персонаж. Марвин Бранаг — его коллега.');
 s.lorePeopleAt=1;s.lorePeople=[{name:'Марвин Бранаг',role:'adult'}];
 s.threads=[{id:'char-id',name:'Леон',kind:'char',pair:true,rel:70,msgs:[{id:'dm',text:'Привет',t:1}],sceneAnchor:{name:'Леон',evidence:'Леон сидит рядом'},unread:1}];
 s.social.following=['Леон'];posts(s,['Leon','Леон Кеннеди']);
 model=()=>JSON.stringify([{name:'Леон Кеннеди',role:'adult',bio:'Полицейский'},{name:'Марвин Бранаг',role:'adult'}]);
 api.onChatChanged();await api.queue();
 assert.equal(calls,1,'old scan refreshed once');assert.equal(s.lorePeopleVersion,2);assert.ok(s.lorePeople.some(p=>p.name==='Леон Кеннеди'));
 assert.ok(prompts[0].includes('основного персонажа Леон'));assert.ok(!prompts[0].includes('кроме Леон и'));
 assert.equal(s.threads.length,1);assert.equal(s.threads[0].id,'char-id');assert.equal(s.threads[0].name,'Леон Кеннеди');assert.equal(s.threads[0].msgs[0].id,'dm');assert.equal(s.threads[0].pair,true);assert.equal(s.threads[0].rel,70);assert.equal(s.threads[0].sceneAnchor.name,'Леон Кеннеди');
 assert.deepEqual(Array.from(s.feed,p=>p.author),['Леон Кеннеди','Леон Кеннеди']);assert.deepEqual(Array.from(s.social.following),['Леон Кеннеди']);assert.equal(api.looksLikeChar('Leon Kennedy'),true);
 api.onChatChanged();await api.queue();assert.equal(calls,1,'new scan does not re-run on every chat switch');
 // Cross-script short card name + full name from description/lore.
 const claire=chat('Claire','В карточке: Клэр Редфилд.','Клэр Редфилд помогает друзьям.');posts(claire,['Claire','Клэр']);
 model=()=>JSON.stringify([{name:'Клэр Редфилд',role:'adult'}]);await api.extractLorePeople(claire);assert.equal(api.canonicalName(claire,'Claire'),'Клэр Редфилд');assert.equal(api.canonicalName(claire,'Claire Redfield'),'Клэр Редфилд');
 assert.deepEqual(Array.from(claire.feed,p=>p.author),['Клэр Редфилд','Клэр Редфилд']);
 // Several people sharing a first name: do not choose a surname for the card.
 const ambiguous=chat('Леон','Персонажа зовут Леон.','Леон Кеннеди и Леон Смит — разные люди.');
 ambiguous.threads=[{id:'short-char',name:'Леон',kind:'char',msgs:[]}];posts(ambiguous,['Leon','Леон Кеннеди','Леон Смит']);
 model=()=>JSON.stringify([{name:'Леон Кеннеди',role:'adult'},{name:'Леон Смит',role:'adult'}]);await api.extractLorePeople(ambiguous);
 assert.equal(ambiguous.lorePeople.length,2);assert.equal(ambiguous.threads[0].name,'Леон');assert.equal(api.samePerson(ambiguous,'Леон','Леон Кеннеди'),false);assert.equal(api.looksLikeChar('Леон Смит'),false);assert.deepEqual(Array.from(ambiguous.feed,p=>p.author),['Леон','Леон Кеннеди','Леон Смит']);
 // A model may know a canonical surname, but cannot invent it if the user's sources don't contain it.
 const invented=chat('Леон','Леон — полицейский.','Друг — Леонид Бранаг.');
 model=()=>JSON.stringify([{name:'Леон Кеннеди',role:'adult'},{name:'Леон Бранаг',role:'adult'},{name:'Леонид Бранаг',role:'adult',aliases:['Леон Бранаг','Никто Неизвестный']}]);
 await api.extractLorePeople(invented);assert.deepEqual(Array.from(invented.lorePeople,p=>p.name),['Леонид Бранаг']);assert.equal(invented.lorePeople[0].aliases.length,0);assert.equal(api.canonicalName(invented,'Леон'),'Леон');
 // Invalid generation leaves previously extracted people and refresh status intact.
 const failed=chat('Леон','Леон','Марвин Бранаг');failed.lorePeople=[{name:'Марвин Бранаг',role:'adult'}];failed.lorePeopleAt=1;model=()=>'{"wrong":"format"}';
 assert.equal(await api.extractLorePeople(failed),0);assert.equal(failed.lorePeople[0].name,'Марвин Бранаг');assert.equal(failed.lorePeopleAt,1);assert.equal(failed.lorePeopleVersion,undefined);
 // A scan from a previous chat cannot rename or write the newly selected chat.
 const stale=chat('Леон','Леон','Леон Кеннеди');let resolve,started;const ready=new Promise(r=>started=r);
 model=()=>{started();return new Promise(r=>resolve=r);};const pending=api.extractLorePeople(stale);await ready;const fresh=chat('Claire','Claire','Клэр Редфилд');resolve('[{"name":"Леон Кеннеди","role":"adult"}]');
 assert.equal(await pending,0);assert.equal(stale.lorePeopleVersion,undefined);assert.equal(fresh.lorePeople.length,0);
 console.log('PASS: short card/full lore name; {{char}} retained; one-time legacy rescan; stable thread/scene/relations; cross-script names; ambiguous surnames; no invented surnames; failed/stale scans');
})().catch(e=>{console.error(e);process.exitCode=1;});
