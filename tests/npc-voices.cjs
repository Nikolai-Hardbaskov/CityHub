const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8').replace('    globalThis.CityHub = {',`globalThis.test={voiceContext,npcVoice,rememberNpcVoices,aiComments,ACT,reply,S,reconcilePeople,cancelUser,updateRel,queue:()=>queue,model:fn=>aiRaw=fn};save=()=>{};render=()=>{};globalThis.CityHub = {`);
function harness(metadata={}){
 const c={characterId:0,chatId:'npc-voice',name1:'Ариша',name2:'Леон',characters:[{description:'Леон — полицейский. Клэр Редфилд — его подруга.'}],chat:[{name:'Леон',mes:'Леон уехал на работу.'},{name:'Ариша',mes:'Я осталась дома.',is_user:true}],chatMetadata:metadata,extensionSettings:{cityhub:{}},setExtensionPrompt(){}};
 const env={console,Date,Math,JSON,Promise,Map,Set,WeakMap,WeakSet,SillyTavern:{getContext:()=>c},window:{addEventListener(){}},document:{getElementById:()=>null},jQuery(){},toastr:{info(){},success(){},warning(){},error(){}},setTimeout(){},clearTimeout(){},setInterval(){}};
 vm.createContext(env);vm.runInContext(src,env);const api=env.test,s=api.S();s.auth=true;return {api,c,s};
}
const voice=(style,emoji='never',slang='never')=>({style,emoji,slang,examples:['Добрый день. Перейдём к делу.']});
(async()=>{
 let {api,c,s}=harness();let prompt,calls=0;
 // New NPC gets a model-created voice together with the first post, without another AI call.
 api.model(async p=>{calls++;prompt=p;return JSON.stringify({posts:[{author:'Ирина Соколова',text:'Добрый день. Встреча начнётся в десять.',voice:voice('IRINA_FIXED_VOICE: деловая, точная речь; полные фразы.')}],stories:[]});});
 await api.ACT.genFeed({},null,s);assert.equal(calls,1);assert.ok(prompt.includes('Для НОВОГО придуманного NPC'));assert.equal(s.npcVoices.length,1);
 const original=JSON.stringify(api.npcVoice(s,'Ирина Соколова'));const id=s.npcVoices[0].id;assert.equal(s.npcVoices[0].source,'generated');assert.equal(s.npcVoices[0].emoji,'never');
 // Replies share the fixed voice; a returned replacement is ignored. A new commenter gets their own.
 const post=s.feed[0];api.model(async p=>{prompt=p;return JSON.stringify([{author:'Ирина',text:'Уточню время.',voice:voice('WRONG_NEW_VOICE','natural','natural')},{author:'Олег Волков',text:'Понял, спасибо.',voice:voice('OLEG_FIXED_VOICE: коротко, спокойно.','rare','light')}]);});
 await api.aiComments(s,post,'Ответь на комментарий.');assert.ok(prompt.includes('IRINA_FIXED_VOICE'));assert.ok(prompt.includes('Эмодзи: never; сленг: never'));assert.equal(JSON.stringify(api.npcVoice(s,'Ирина Соколова')),original);assert.ok(api.npcVoice(s,'Олег Волков').style.includes('OLEG_FIXED_VOICE'));
 // Removing the feed and reloading metadata does not remove or recreate the voice.
 s.feed=[];({api,c,s}=harness(JSON.parse(JSON.stringify(c.chatMetadata))));assert.equal(api.npcVoice(s,'Ирина Соколова').id,id);assert.equal(JSON.stringify(api.npcVoice(s,'Ирина Соколова')),original);
 api.model(async p=>{prompt=p;return '{"posts":[{"author":"Ирина Соколова","text":"Новый пост."}]}';});await api.ACT.genFeed({},null,s);assert.ok(prompt.includes('IRINA_FIXED_VOICE'));assert.equal(JSON.stringify(api.npcVoice(s,'Ирина Соколова')),original);
 // Automated cancellation posts and dating profiles also use/assign the same stored voices.
 api.model(async p=>{prompt=p;return JSON.stringify([{author:'Денис Миронов',text:'Разберёмся спокойно.',voice:voice('DENIS_FIXED_VOICE')}]);});api.cancelUser(s);await api.queue();assert.ok(prompt.includes('IRINA_FIXED_VOICE'));assert.ok(api.npcVoice(s,'Денис Миронов').style.includes('DENIS_FIXED_VOICE'));
 api.model(async p=>{prompt=p;return JSON.stringify([{name:'Софья Белова',age:25,character:'Сдержанная.',bio:'Люблю книги.',voice:voice('SOFIA_FIXED_VOICE')}]);});await api.ACT.genDating({},null,s);assert.ok(prompt.includes('IRINA_FIXED_VOICE'));assert.ok(api.npcVoice(s,'Софья Белова').style.includes('SOFIA_FIXED_VOICE'));
 // The same voice goes into private replies; conflict affects tone, not the profile.
 const th={id:'irina-dm',name:'Ирина Соколова',kind:'dm',known:true,rel:-12,msgs:[{me:true,text:'Привет.',t:1}],conflict:{why:'BROKEN_PROMISE',source:'story'}};s.threads=[th];
 api.model(async p=>p.startsWith('Проверка текущей сцены')?'{"state":"apart","evidence":""}':(prompt=p,'{"reply":"Поговорим позже.","delta":0}'));assert.equal(await api.reply(s,th),'delivered');assert.ok(prompt.includes('IRINA_FIXED_VOICE'));assert.ok(prompt.includes('BROKEN_PROMISE'));assert.equal(JSON.stringify(api.npcVoice(s,'Ирина Соколова')),original);
 // A conflict-triggered post keeps the NPC's voice and may be silent if that fits their character.
 const hateBefore=s.social.hate,notesBefore=s.notes.length;th.rel=-61;api.model(async p=>{prompt=p;return '{"text":"","media":""}';});api.updateRel(s,th,-1,false);await api.queue();assert.ok(prompt.includes('IRINA_FIXED_VOICE'));assert.ok(prompt.includes('не навязывай язвительность'));assert.equal(s.social.hate,hateBefore);assert.equal(s.notes.length,notesBefore);assert.equal(JSON.stringify(api.npcVoice(s,'Ирина Соколова')),original);
 th.beef=false;api.model(async p=>{prompt=p;return '{"text":"У меня остались претензии.","media":""}';});api.updateRel(s,th,0,false);await api.queue();assert.equal(s.social.hate,Math.min(100,hateBefore+10));assert.equal(s.notes.length,notesBefore+1);assert.ok(s.feed.some(p=>p.text==='У меня остались претензии.'));
 // A live lore entry overrides the generated voice even before the people scan refreshes.
 c.characters[0].data={character_book:{entries:[{keys:['Ирина Соколова'],content:'RAW_LORE_OVERRIDE: новая заданная манера.'}]}};const rawLore=await api.voiceContext(s,['Ирина Соколова']);assert.ok(rawLore.includes('RAW_LORE_OVERRIDE'));assert.ok(!rawLore.includes('IRINA_FIXED_VOICE'));assert.equal(api.npcVoice(s,'Ирина Соколова').id,id);
 // A later lore description overrides the generated voice without deleting its archived profile.
 s.lorePeople=[{name:'Ирина Соколова',role:'adult',bio:'LORE_OVERRIDE: иная заданная пользователем манера.'}];const fromLore=await api.voiceContext(s,['Ирина Соколова']);assert.ok(fromLore.includes('LORE_OVERRIDE'));assert.ok(!fromLore.includes('IRINA_FIXED_VOICE'));assert.equal(api.npcVoice(s,'Ирина Соколова').id,id);
 // Main character, user, explicit card NPC, lore NPC and non-person threads are excluded.
 const count=s.npcVoices.length;s.threads.push({id:'office',name:'Мэрия',kind:'official',msgs:[]},{id:'group',name:'Коллеги',kind:'group',msgs:[]});api.rememberNpcVoices(s,['Леон','Ариша','Клэр Редфилд','Ирина Соколова','Мэрия','Коллеги'].map(name=>({name,voice:voice('BAD')})));assert.equal(s.npcVoices.length,count);
 c.characters[0].description+='Описание. '.repeat(800)+' Мария Северова — ещё один NPC из карточки.';api.rememberNpcVoices(s,[{name:'Мария Северова',voice:voice('SHOULD_NOT_OVERRIDE_CARD')}]);assert.equal(api.npcVoice(s,'Мария Северова'),undefined);
 // Different surnames remain different people; transliteration variants merge, retaining the earliest voice.
 api.rememberNpcVoices(s,[{name:'Марк Смит',voice:voice('MARK_SMITH')},{name:'Марк Джонс',voice:voice('MARK_JONES')}]);assert.notEqual(api.npcVoice(s,'Марк Смит').id,api.npcVoice(s,'Марк Джонс').id);
 s.npcVoices.push({name:'Oleg Volkov',id:'duplicate',style:'BAD_DUPLICATE',createdAt:Date.now()+10000});api.reconcilePeople(s);assert.equal(s.npcVoices.filter(v=>v.name==='Олег Волков').length,1);assert.ok(api.npcVoice(s,'Олег Волков').style.includes('OLEG_FIXED_VOICE'));
 // Existing NPCs are migrated once from public speech, without embedding private messages in examples.
 s.feed=[{id:'old',author:'Анна Морозова',text:'Добрый день. Я проверю документы.',comments:[]}];s.threads.push({id:'anna',name:'Анна Морозова',kind:'dm',msgs:[{text:'PRIVATE_SECRET',me:false}],bio:'Внимательная.'});await api.voiceContext(s,['Анна Морозова']);const legacy=JSON.stringify(api.npcVoice(s,'Анна Морозова'));assert.equal(api.npcVoice(s,'Анна Морозова').source,'legacy');assert.ok(!legacy.includes('PRIVATE_SECRET'));
 s.feed[0].text='ДРУГАЯ МАНЕРА 😂 лол';await api.voiceContext(s,['Анна Морозова']);assert.equal(JSON.stringify(api.npcVoice(s,'Анна Морозова')),legacy);
 // Missing/malformed voice output still has a stable, conservative fallback.
 api.rememberNpcVoices(s,[{name:'Пётр Орлов',voice:{style:[],emoji:'invalid'},text:'Здравствуйте.'}]);const fallback=JSON.stringify(api.npcVoice(s,'Пётр Орлов'));assert.equal(api.npcVoice(s,'Пётр Орлов').emoji,'never');await api.voiceContext(s,['Пётр Орлов']);assert.equal(JSON.stringify(api.npcVoice(s,'Пётр Орлов')),fallback);
 // A result from an old chat cannot create a profile after switching to a different chat.
 let release,started;const ready=new Promise(r=>started=r);api.model(()=>{started();return new Promise(r=>release=r);});const before=s.npcVoices.length;const pending=api.aiComments(s,s.feed[0],'Ответь.');await ready;c.chatId='other';c.chatMetadata={};release(JSON.stringify([{author:'Устаревший Автор',text:'Привет.',voice:voice('STALE')} ]));await pending;assert.equal(s.npcVoices.length,before);assert.equal(api.S().npcVoices.length,0);
 // Equal names in independent chats do not share a profile.
 const fresh=api.S();api.rememberNpcVoices(fresh,[{name:'Олег Волков',voice:voice('OTHER_CHAT_VOICE')}]);assert.ok(api.npcVoice(fresh,'Олег Волков').style.includes('OTHER_CHAT_VOICE'));assert.ok(api.npcVoice(s,'Олег Волков').style.includes('OLEG_FIXED_VOICE'));
 console.log('PASS: generated NPC voice assigned once; feed/comments/DM and automated posts; dating assignment; reload and feed trimming; aliases/homonyms; separate chats; conflict tone; later lore priority; legacy migration; private-example isolation; malformed fallback; stale results');
})().catch(e=>{console.error(e);process.exitCode=1;});
