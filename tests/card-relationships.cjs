const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const c={characterId:0,chatId:'pair',name1:'Ариша',name2:'Леон',chat:[],characters:[{}],chatMetadata:{},extensionSettings:{cityhub:{}},setExtensionPrompt(){}};
const env={console,Date,Math,JSON,Promise,Map,Set,WeakMap,WeakSet,SillyTavern:{getContext:()=>c},window:{addEventListener(){}},document:{getElementById:()=>null},jQuery(){},toastr:{info(){},success(){},warning(){},error(){}},setTimeout(){},clearTimeout(){},setInterval(){}};
vm.createContext(env);let src=fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8').replace('    globalThis.CityHub = {',`globalThis.test={syncRel,needsRelSync,cardPairFact,charCard,relLabel,model:fn=>aiJSON=fn};save=()=>{};render=()=>{};globalThis.CityHub = {`);
vm.runInContext(src,env);const api=env.test;
const msg=(mes,is_user=false)=>({name:is_user?c.name1:c.name2,mes,is_user});
let s,th,prompt;
function setup(description){c.chatId+='x';c.chatMetadata={};c.characters=[{description}];c.chat=[msg('Леон поехал на патруль.'),msg('Я продолжаю работу.',true)];s=env.CityHub.state();s.auth=true;th={id:'char',kind:'char',name:'Леон',msgs:[],rel:0};s.threads=[th];return th;}
const unknown={known:false,pair:false,rel:0,status:'не знакомы',note:'В чате ещё не общались',presence:{busy:true,reason:'на патруле',until:null}};
async function evaluate(response){api.model(async p=>{prompt=p;return response;});await api.syncRel(s,th);}
const event=(state,source,evidence)=>({known:true,pair:state==='together',rel:40,status:state==='together'?'пара':'бывшая пара',note:'Событие истории',pairChange:{state,source,evidence}});
(async()=>{
 // The exact screenshot premise after the old 3500-character description cutoff.
 setup('Appearance: '+ 'Long description. '.repeat(300)+'\nRELATIONSHIPS: {{user}} is his girlfriend; they have been dating for quite some time and are in a serious relationship.');
 assert.ok(!api.charCard().includes('is his girlfriend'));assert.ok(api.cardPairFact(s,th));
 await evaluate(unknown);assert.equal(th.known,true);assert.equal(th.pair,true);assert.equal(th.status,'пара');assert.equal(api.relLabel(th),'пара');assert.equal(s.profile.relWithChar,true);assert.ok(prompt.includes('Ариша is his girlfriend'));assert.ok(prompt.includes('Отсутствие переписки'));assert.ok(!s.notes.some(n=>n.text.includes('не пара')));assert.equal(th.presence.busy,true,'work affects availability, not romance');assert.equal(api.needsRelSync(s,th),false);
 // Missing pairChange, invented evidence, ordinary work and a quarrel cannot remove the pair.
 await evaluate({...unknown,known:true,status:'знакомые'});assert.equal(th.pair,true);
 await evaluate(event('apart','story','Мы расстались.'));assert.equal(th.pair,true,'nonexistent quote rejected');
 c.chat.push(msg('Он занят на работе.'));await evaluate(event('apart','story','Он занят на работе.'));assert.equal(th.pair,true);
 c.chat.push(msg('Мы поссорились из-за опоздания.'));await evaluate({...event('apart','story','Мы поссорились из-за опоздания.'),rel:-40,status:'ссора'});assert.equal(th.pair,true);assert.equal(s.profile.relWithChar,true);assert.equal(api.relLabel(th),'в ссоре');
 // Real breakup overrides the card and persists when outside recent context.
 const breakup='Мы расстались. Наши отношения закончены.';c.chat.push(msg(breakup));await evaluate(event('apart','story',breakup));assert.equal(th.pair,false);assert.equal(s.profile.relWithChar,false);assert.equal(th.pairMemory.source,'story');
 for(let i=0;i<25;i++)c.chat.push(msg('Обычный рабочий день '+i));await evaluate(unknown);assert.equal(th.pair,false);assert.equal(th.known,true);assert.equal(th.status,'бывшая пара');
 // A later reunion wins; an older breakup still present in history cannot overwrite it.
 const reunion='Мы снова пара и начали встречаться.';c.chat.push(msg(reunion));await evaluate(event('together','story',reunion));assert.equal(th.pair,true);assert.equal(s.profile.relWithChar,true);
 c.chat=c.chat.slice(0,2).concat([msg(breakup),msg(reunion)]);await evaluate(event('together','story',reunion));
 await evaluate(event('apart','story',breakup));assert.equal(th.pair,true,'older event cannot undo reunion');c.chat.push(msg(breakup));await evaluate(event('apart','story',breakup));assert.equal(th.pair,false,'later breakup still works after history indices shift');
 // Rewind/removal of the confirmed breakup restores a sourced card baseline.
 setup('{{user}} — его девушка.');c.chat.push(msg(breakup));await evaluate(event('apart','story',breakup));assert.equal(th.pair,false);c.chat.pop();await evaluate(unknown);assert.equal(th.pair,true);assert.equal(th.pairMemory,null);
 // Actual messenger events count too; a subsequent story event can change them.
 th.msgs.push({me:true,text:breakup,t:1});await evaluate(event('apart','dm',breakup));assert.equal(th.pair,false);assert.equal(th.pairMemory.source,'dm');
 c.chat.push(msg(reunion));await evaluate(event('together','story',reunion));assert.equal(th.pair,true);
 // No preview notifications or profile changes before an opening is accepted.
 setup('{{user}} is his girlfriend.');c.chat=[msg('Напиши вступление',true),msg('Леон на патруле.')];await evaluate(unknown);assert.equal(th.known,true);assert.equal(th.pair,true);assert.equal(s.profile.relWithChar,false);assert.equal(s.notes.length,0);assert.equal(th.pairMemory,undefined);
 // Strict positive premise: avoid generic preferences, third parties, hypothetical/ex/negative facts, and style examples.
 for(const description of ['He takes care of his girlfriend.','Ada is his girlfriend.','{{user}} is not his girlfriend.','{{user}} is his ex-girlfriend.','If {{user}} is his girlfriend, he would be happy.','It is not true that {{user}} is his girlfriend.','{{user}} is his girlfriend, but they broke up years ago.']){setup(description);assert.equal(api.cardPairFact(s,th),null,description);}
 setup('They are strangers.');c.characters[0].mes_example='{{user}} is his girlfriend.';c.characters[0].first_mes='{{user}} is his girlfriend.';assert.equal(api.cardPairFact(s,th),null);
 for(const description of ['{{user}} is {{char}}\'s girlfriend.','{{char}} is {{user}}\'s boyfriend.','{{user}} and {{char}} are dating.','{{user}} является его женой.','{{user}} и {{char}} давно встречаются.','Ариша — его девушка.']){setup(description);assert.ok(api.cardPairFact(s,th),description);}
 setup('');c.characters[0]={data:{scenario:'{{user}} is his girlfriend.'}};assert.ok(api.cardPairFact(s,th),'v2 scenario included');
 // Opening candidates don't persist a pair; a confirmed start in real history does.
 setup('');c.chat=[msg('Начни',true),msg('We are dating now.')];await evaluate(event('together','story','We are dating now.'));assert.equal(s.profile.relWithChar,false);assert.equal(th.pairMemory,undefined);
 c.chat.push(msg('Да, встречаемся.',true));await evaluate(event('together','story','We are dating now.'));assert.equal(th.pair,true);assert.equal(s.profile.relWithChar,true);
 c.chat[1].mes='Мы ещё не знакомы.';await evaluate(unknown);assert.equal(th.pair,false,'removed confirmation does not survive a swipe');
 // Hypothetical/negated proposals and physical parting are not relationship changes.
 setup('{{user}} is his girlfriend.');for(const text of ['Если мы расстаёмся, что будет дальше?','We did not break up.','Мы расстались у метро, каждый пошёл по своим делам.']){c.chat.push(msg(text));await evaluate(event('apart','story',text));assert.equal(th.pair,true,text);}
 // Other couples and unsupported card quotes cannot change this pair.
 setup('{{user}} is his girlfriend.');const otherBreak='Джилл и Крис расстались.';c.chat.push(msg(otherBreak));await evaluate(event('apart','story',otherBreak));assert.equal(th.pair,true);
 setup('Lovers: Ариша and Леон are a romantic couple.');assert.equal(api.cardPairFact(s,th),null);await evaluate({...unknown,cardRelationship:{pair:true,evidence:'Lovers: Ариша and Леон are a romantic couple.'}});assert.equal(th.pair,true);assert.equal(th.known,true);
 setup('They are strangers.');await evaluate({...unknown,cardRelationship:{pair:true,evidence:'Ариша is his girlfriend.'}});assert.equal(th.pair,false,'invented card evidence rejected');
 setup('Ada is his girlfriend.');await evaluate({...unknown,cardRelationship:{pair:true,evidence:'Ada is his girlfriend.'}});assert.equal(th.pair,false,'other partner is not the user');
 // Card edits trigger a new evaluation, and an in-flight result using the old card is discarded.
 setup('');await evaluate(unknown);assert.equal(api.needsRelSync(s,th),false);c.characters[0].description='{{user}} is his girlfriend.';assert.equal(api.needsRelSync(s,th),true);
 let release,started;const ready=new Promise(r=>started=r);api.model(()=>{started();return new Promise(r=>release=r);});const pending=api.syncRel(s,th);await ready;c.characters[0].description='{{user}} is his wife.';release(unknown);await pending;assert.equal(th.pair,false);assert.equal(th.relSyncing,false);assert.equal(api.needsRelSync(s,th),true);
 console.log('PASS: long screenshot card; English/Russian/v2 premises; known couple without DMs; busy/quarrel; explicit breakup/reunion and evidence; retained history/rewinds; DM changes; preview protection; negative/third-party examples; card edit and stale response');
})().catch(e=>{console.error(e);process.exitCode=1;});
