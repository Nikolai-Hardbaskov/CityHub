const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const events = new Map(), timers = new Map(), intervals = [];
let nextTimer = 0, aiCalls = 0, hold = null;
const prompts = new Map();
const eventNames = ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'CHARACTER_EDITED', 'PERSONA_CHANGED', 'GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'GENERATION_ENDED', 'GENERATION_STOPPED'];
const context = {
  characterId: 0, chatId: 'a', name1: 'Игрок', name2: 'Персонаж', chat: [], chatMetadata: {}, characters: [{}],
  extensionSettings: { cityhub: { syncAI: true, syncHorae: false, crimeScan: false } },
  event_types: Object.fromEntries(eventNames.map(x => [x, x])),
  eventSource: { on: (name, fn) => events.set(name, [...(events.get(name) || []), fn]) },
  setExtensionPrompt: (key, value) => prompts.set(key, value),
  saveMetadata() {}, saveSettingsDebounced() {},
  async generateRaw({prompt}) {
    aiCalls++;
    if (hold) { const fn = hold; hold = null; return await fn(prompt); }
    if (prompt.includes('Определи ТЕКУЩИЕ дату')) return prompt.includes('третий день октября') ? '{"explicit":true,"date":"2024-10-03","time":"09:20"}' : '{"explicit":false}';
    if (prompt.includes('Часы истории перед')) return JSON.stringify({minutes:prompt.includes('Исправленный ответ') ? 5 : 10,time:null});
    if (prompt.includes('какие СЕЙЧАС отношения')) return '{"known":true,"rel":60,"status":"друзья","pair":false,"note":"общаются в истории"}';
    return '{}';
  },
};
const sandbox = {
  console, Date, Math, JSON, Set, Map, WeakSet, WeakMap, Promise,
  SillyTavern: { getContext: () => context },
  window: { addEventListener() {} }, document: { getElementById: () => null },
  jQuery() {}, navigator: { userAgent: 'test' },
  setTimeout: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; },
  clearTimeout: id => timers.delete(id),
  setInterval: fn => intervals.push(fn),
};
vm.createContext(sandbox);
let source = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.js'), 'utf8');
source = source.replace('    globalThis.CityHub = {', `
    globalThis.__test = { init, observeStory, storyRevision, syncRel, onChatChanged, parseClockStamp, readHorae, queue: () => queue,
        switchState: (s) => { globalThis.__active = s; },
        active: () => S(), clock: onStoryMessage };
    const seed = S(); globalThis.__active = seed;
    S = () => globalThis.__active;
    tick = () => {}; render = () => {}; mount = () => {}; checkFab = () => {};
    save = (s) => { if (!s || S() === s) updateInjection(); };
    globalThis.CityHub = {`);
vm.runInContext(source, sandbox);
const api = sandbox.__test;
const s = api.active();
s.auth = true; s.campusLoreAt = s.genClubsAt = s.lorePeopleAt = Date.now(); s.lorePeopleVersion = 3;
s.clock.t = new Date(2026, 9, 2, 12).getTime();
s.clock.mode = 'game';
context.chat.push({name:'Персонаж', is_user:false, mes:'Начало истории', send_date:'a0'});
function emit(name, ...args) { for (const fn of events.get(name) || []) fn(...args); }
async function flush() {
  for (let rounds = 0; rounds < 10; rounds++) {
    const batch = [...timers.values()]; timers.clear();
    batch.forEach(fn => fn());
    await api.queue(); await Promise.resolve();
    if (!timers.size) return;
  }
  throw Error('Sync did not settle');
}
function assistant(text, id) { context.chat.push({name:'Персонаж',is_user:false,mes:text,send_date:id}); return context.chat.length-1; }
(async () => {
  api.init(); await flush();
  const base = s.clock.t;
  assert.equal(aiCalls, 1, 'loading existing chat attempts alignment without adding a clock step');
  emit('GENERATION_STARTED','normal');
  const i = assistant('Прошло десять минут', 'a1');
  emit('MESSAGE_RECEIVED',i); emit('CHARACTER_MESSAGE_RENDERED',i);
  assert.equal(s.clock.t,base,'wait until generation finishes');
  emit('GENERATION_ENDED',i); await flush();
  assert.equal(s.clock.t,base+600000); assert.equal(s.replyCount,1);
  const calls = aiCalls;
  emit('MESSAGE_RECEIVED',i); emit('GENERATION_ENDED',i); await flush();
  intervals[0](); await flush();
  assert.equal(s.clock.t,base+600000); assert.equal(s.replyCount,1); assert.equal(aiCalls,calls);
  context.chat[i].mes='Исправленный ответ'; context.chat[i].swipe_id=1;
  emit('MESSAGE_SWIPED',i); emit('MESSAGE_EDITED',i); await flush();
  assert.equal(s.clock.t,base+300000,'swipe replaces prior step instead of adding another');
  assert.equal(s.replyCount,1);
  // Two received messages while the main generation is busy must both be processed.
  emit('GENERATION_STARTED','normal');
  emit('MESSAGE_RECEIVED',assistant('Следующий ответ','a2'));
  emit('MESSAGE_RECEIVED',assistant('Ещё один ответ','a3'));
  emit('GENERATION_ENDED'); await flush();
  assert.equal(s.clock.t,base+1500000); assert.equal(s.replyCount,3);
  context.chat.pop(); emit('MESSAGE_DELETED'); await flush();
  assert.equal(s.clock.t,base+900000,'deleted tail answer restores prior clock');
  s.threads.push({id:'char',kind:'char',name:'Персонаж',msgs:[],rel:0,t:Date.now()});
  api.observeStory(); await flush();
  assert.equal(s.threads[0].status,'друзья','relations sync while CityHub is closed');
  const relCalls=aiCalls;
  intervals[0](); await flush(); assert.equal(aiCalls,relCalls,'poll does not regenerate unchanged relationships');
  context.chat[0].mes='Отредактированная история без изменения числа сообщений';
  emit('MESSAGE_EDITED',0); await flush();
  assert.equal(s.threads[0].relStoryRevision,api.storyRevision()); assert.ok(aiCalls>relCalls);
  s.threads.push({id:'npc',kind:'dm',name:'Сосед',msgs:[{me:true,text:'Уже договорились о встрече',t:1}],t:2});
  assert.ok(sandbox.CityHub._inj().includes('Уже договорились о встрече'),'old NPC DM remains in narrator context');
  // A reply computed in one chat must not write into a different chat, even after returning.
  let release, started;
  const startedPromise=new Promise(r=>started=r);
  hold=()=>{started();return new Promise(r=>release=r);};
  emit('MESSAGE_RECEIVED',assistant('Запрос перед переключением','a4'));
  await startedPromise;
  const originalClock=s.clock.t;
  const b=JSON.parse(JSON.stringify(s)); b.clock.t=base; b.threads=[]; b.storyClockHistory=[];
  api.switchState(b); context.chat=[{name:'Персонаж',is_user:false,mes:'Другой чат',send_date:'b0'}];
  api.onChatChanged(); release('{"minutes":60}'); await flush();
  assert.equal(s.clock.t,originalClock); assert.equal(b.clock.t,base);
  // Horae can update metadata without an assistant event, and identical HH:MM cannot advance a day repeatedly.
  context.extensionSettings.cityhub.syncHorae=true;
  context.chatMetadata.horae={time:'12:30'};
  intervals[0](); await flush(); assert.equal(b.clock.t,new Date(2026,9,2,12,30).getTime());
  const horaeClock=b.clock.t;
  intervals[0](); await flush(); assert.equal(b.clock.t,horaeClock);
  context.chatMetadata.horae.time='2026-10-02 11:45';
  intervals[0](); await flush(); assert.equal(b.clock.t,new Date(2026,9,2,11,45).getTime(),'authoritative Horae update may correct time backwards');
  // Real Horae schema: the public API returns separate story_date/story_time fields.
  context.chatMetadata = {};
  let horaeState = {timestamp:{story_date:'2024-12-31',story_time:'23:55'}};
  sandbox.window.Horae = {isEnabled:()=>true,getLatestState:()=>horaeState};
  intervals[0](); await flush();
  assert.equal(b.clock.t,new Date(2024,11,31,23,55).getTime(),'read actual Horae API schema and story year');
  horaeState.timestamp={story_date:'2025-01-01',story_time:'00:05'};
  intervals[0](); await flush();
  assert.equal(b.clock.t,new Date(2025,0,1,0,5).getTime(),'Horae date rollover');
  b.clock.t=base;
  intervals[0](); await flush();
  assert.equal(b.clock.t,new Date(2025,0,1,0,5).getTime(),'restore authoritative time even if cached key is unchanged');
  delete sandbox.window.Horae;
  context.chat=[
    {name:'Персонаж',is_user:false,mes:'Сцена',send_date:'c0',horae_meta:{timestamp:{story_date:'2024-10-01',story_time:'15:00'}}},
    ...Array.from({length:5},(_,i)=>({name:'Игрок',is_user:true,mes:'Реплика',send_date:`cu${i}`})),
    {name:'Персонаж',is_user:false,mes:'Позже',send_date:'c1',horae_meta:{timestamp:{story_time:'16:30'}}},
  ];
  intervals[0](); await flush();
  assert.equal(b.clock.t,new Date(2024,9,1,16,30).getTime(),'merge date and time from all message metadata');
  context.chat=context.chat.slice(0,1);
  context.chat[0].horae_meta.timestamp={story_date:'02.10.2024',story_time:'18:45'};
  intervals[0](); await flush();
  assert.equal(b.clock.t,new Date(2024,9,2,18,45).getTime(),'date with dots is not a clock');
  delete context.chat[0].horae_meta;
  context.chat[0].mes='<horae>\ntime:10/1 15:00\nlocation:home\n</horae>';
  intervals[0](); await flush();
  assert.equal(b.clock.t,new Date(2024,9,1,15,0).getTime(),'raw Horae short date uses month/day');
  context.extensionSettings.cityhub.syncHorae=false;
  context.chat[0].mes='Дата: 01.10.2024\nВремя: 08:15\nМы стоим у дома.';
  intervals[0](); await flush();
  assert.equal(b.clock.t,new Date(2024,9,1,8,15).getTime(),'explicit main-chat header aligns backwards without an artificial extra day');
  context.chat[0].mes='Наступил третий день октября 2024 года, сейчас 09:20.';
  b.clock.t=base;
  api.onChatChanged(); await flush();
  assert.equal(b.clock.t,new Date(2024,9,3,9,20).getTime(),'initial chat scene alignment uses story date rather than the phone date');
  assert.equal(api.parseClockStamp('2024-02-30','15:00',base),null,'reject impossible Gregorian date');
  assert.equal(api.parseClockStamp('2024-10-02','24:15',base),null,'reject invalid clock');
  assert.equal(api.parseClockStamp('','02.10.2024',base),null,'date-only text cannot be treated as HH.MM');
  assert.equal(api.parseClockStamp('2024年10月2日','18：45',base),new Date(2024,9,2,18,45).getTime());
  sandbox.window.Horae={isEnabled:()=>false,getLatestState:()=>horaeState};
  assert.equal(api.readHorae(),null,'disabled Horae cannot override main chat time');
  delete sandbox.window.Horae;
  // No API loop caused by CityHub's own quiet generation events.
  const beforeQuiet=aiCalls;
  emit('GENERATION_STARTED','quiet'); emit('GENERATION_ENDED'); await flush();
  assert.equal(aiCalls,beforeQuiet);
  // Unknown time is invented once, persisted, and replaced when a reliable source appears.
  const newState = () => {
    const state = JSON.parse(JSON.stringify(b));
    state.clock = {mode:'game',t:new Date(2026,9,2,12).getTime(),source:'старт'};
    state.threads=[]; state.storyClockHistory=[];
    delete state.storyAlignedKey;
    return state;
  };
  const unknown=newState(); api.switchState(unknown);
  context.chat=[{name:'Персонаж',is_user:false,mes:'Они открывают дверь.',send_date:'u0'}];
  context.chatMetadata={}; context.extensionSettings.cityhub.syncHorae=true;
  api.onChatChanged(); await flush();
  assert.equal(unknown.clock.t,new Date(2026,9,2,9).getTime());
  assert.equal(unknown.clock.source,'придуманное время'); assert.equal(unknown.clock.generated,true);
  const inventedCalls=aiCalls, inventedTime=unknown.clock.t;
  intervals[0](); await flush(); api.onChatChanged(); await flush();
  assert.equal(unknown.clock.t,inventedTime); assert.equal(aiCalls,inventedCalls,'invented time survives polls and reloads');
  context.chat[0].mes='Дата: 01.10.2024\nВремя: 14:20\nОни открывают дверь.';
  emit('MESSAGE_EDITED',0); await flush();
  assert.equal(unknown.clock.t,new Date(2024,9,1,14,20).getTime()); assert.equal(unknown.clock.generated,false);
  sandbox.window.Horae={isEnabled:()=>true,getLatestState:()=>({timestamp:{story_date:'2024-10-02',story_time:'10:50'}})};
  emit('horae:portsChanged'); await flush();
  assert.equal(unknown.clock.t,new Date(2024,9,2,10,50).getTime(),'Horae has priority over conflicting chat header');
  delete sandbox.window.Horae;
  const guess=newState(); api.switchState(guess); context.chat=[{name:'Персонаж',is_user:false,mes:'Они смотрят на закат.',send_date:'g0'}];
  hold=async()=>'{"explicit":false,"date":null,"time":"17:40"}';
  api.onChatChanged(); await flush();
  assert.equal(guess.clock.t,new Date(2026,9,2,17,40).getTime(),'use plausible time invented by AI');
  const offline=newState(); api.switchState(offline); context.chat=[{name:'Персонаж',is_user:false,mes:'Дата: 01.10.2024\nОни открывают дверь.',send_date:'off0'}];
  hold=async()=>''; api.onChatChanged(); await flush();
  assert.equal(offline.clock.t,new Date(2024,9,1,9).getTime(),'fallback also works without API and preserves known date');
  context.extensionSettings.cityhub.syncAI=false;
  const noAI=newState(); api.switchState(noAI); context.chat=[{name:'Персонаж',is_user:false,mes:'На улице глубокая ночь.',send_date:'n0'}];
  const callsBeforeNoAI=aiCalls; api.onChatChanged(); await flush();
  assert.equal(noAI.clock.t,new Date(2026,9,2,23).getTime()); assert.equal(aiCalls,callsBeforeNoAI);
  const empty=newState(); api.switchState(empty); context.chat=[]; api.onChatChanged(); await flush();
  assert.equal(empty.clock.t,new Date(2026,9,2,9).getTime(),'empty chat gets a persistent invented start time');
  const manual=newState(); manual.clock.source='вручную'; api.switchState(manual);
  context.chat=[{name:'Персонаж',is_user:false,mes:'Они открывают дверь.',send_date:'m0'}];
  api.onChatChanged(); await flush(); assert.equal(manual.clock.t,new Date(2026,9,2,12).getTime(),'unknown scene does not overwrite manually set time');
  console.log('PASS: synchronization regressions; invented time persistence; AI suggestion; offline/no-AI/empty-chat fallback; known-date preservation; later chat/Horae priority; manual time preservation');
})().catch(e=>{console.error(e);process.exitCode=1;});
