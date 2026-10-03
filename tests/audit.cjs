const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const sourcePath = process.env.CITYHUB_AUDIT_SOURCE || path.join(__dirname, '..', 'index.js');
const raw = fs.readFileSync(sourcePath, 'utf8');
const source = raw.replace('    globalThis.CityHub = {', `
    globalThis.test = { S, ACT, ui, pay, tx, inst, occurrences, genLifeSchedule, loreText, loreFor, bookingDraft,
      tick, save, syncRel, updateRel, fireHook, buildInjection, refreshQuests, queueStorySync, storySession,
      reply, scanCrimes, screenHTML, TABS, VIEWS, onChatChanged, withBusy, applyConsequence, findOcc,
      validSchedule: typeof validSchedule === 'function' ? validSchedule : null,
      dayOf, model: fn => aiRaw = fn, queue: () => queue, enqueue,
      worldInfo: value => worldInfoModule = Promise.resolve(value),
      scene: fn => mayReceivePersonal = fn,
      opening: fn => hasStoryProgress = fn,
    }; render = () => {}; mount = () => {}; updateFab = () => {}; updateInjection = () => {};
    globalThis.CityHub = {`);
function harness() {
    const fields = new Map(), notices = [], calls = [];
    const c = { characterId: 0, chatId: 'audit', name1: 'Ариша', name2: 'Леон',
        characters: [{ avatar: 'Leon.png', description: 'Леон — полицейский.', data: {} }],
        chat: [{ name: 'Леон', mes: 'Леон уехал на работу.' }, { name: 'Ариша', mes: 'Я осталась дома.', is_user: true }],
        chatMetadata: {}, extensionSettings: { cityhub: { crimeScan: false } },
        setExtensionPrompt() {}, saveMetadata() { calls.push(c.chatId); },
    };
    const math = Object.create(Math);
    const timers = new Map(); let timerId = 0;
    const env = { console, Date, Math: math, JSON, Promise, Map, Set, WeakMap, WeakSet,
        navigator: { userAgent: 'audit' }, SillyTavern: { getContext: () => c },
        window: { addEventListener() {} }, document: { getElementById: id => fields.get(id) || null },
        jQuery() {}, confirm: () => true, toastr: Object.fromEntries(['success', 'info', 'warning', 'error'].map(k => [k, t => notices.push([k, t])])),
        setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval() {},
    };
    vm.createContext(env); vm.runInContext(source, env);
    const api = env.test, s = api.S(); s.auth = true; s.profile.name = 'Ариша'; s.profile.profession = 'Охранник';
    s.clock = { mode: 'game', t: new Date(2028, 9, 2, 12).getTime(), source: 'ручное время' };
    api.opening(() => true); api.scene(async () => true); api.model(async () => '{}');
    const set = (id, value) => fields.set(id, { value: String(value), checked: false });
    const switchChat = () => { c.chatId = 'other'; c.chatMetadata = {}; api.S(); };
    return { api, c, s, set, fields, notices, calls, math, timers, switchChat };
}
const tests = [];
const test = (name, run) => tests.push([name, run]);
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

test('invalid amounts cannot change balance or history; free services remain valid', () => {
    const { api, s } = harness(); const balance = s.wallet.balance;
    for (const amount of [NaN, Infinity, -Infinity, -100]) assert.equal(api.pay(s, amount, 'bad'), false);
    assert.equal(s.wallet.balance, balance); assert.equal(s.wallet.history.length, 0);
    assert.equal(api.tx(s, NaN, 'bad'), false); assert.equal(api.tx(s, 1e308, 'bad'), false);
    assert.equal(s.wallet.balance, balance); assert.equal(api.pay(s, 0, 'free'), true);
    assert.equal(api.pay(s, 100, 'good'), true); assert.equal(s.wallet.balance, balance - 100);
});
test('night shifts survive generation and are found after midnight', async () => {
    const { api, s } = harness(); api.model(async () => JSON.stringify([0, 2].map(day => ({ day, start: '22:00', end: '06:00', type: 'work', subject: 'Ночная охрана' }))));
    s.schedule = await api.genLifeSchedule(s); assert.equal(s.schedule[0].start, '22:00');
    const at = new Date(2028, 9, 3, 5).getTime(); const active = api.occurrences(s, at, at).find(o => o.start <= at && o.end > at);
    assert.ok(active); assert.equal(new Date(active.end).getHours(), 6); assert.equal(new Date(active.start).getDate(), 2);
    s.clock.t = at; api.ACT.checkin({ key: active.key }, null, s); assert.equal(s.attendance[active.key], 'present');
});
test('invalid times and overlapping weekly slots are rejected', () => {
    const { api } = harness(); assert.equal(typeof api.validSchedule, 'function');
    const slots = [
        { day: 6, start: '22:00', end: '06:00', subject: 'Ночь' },
        { day: 0, start: '05:00', end: '07:00', subject: 'Пересечение недели' },
        { day: 1, start: '99:00', end: '99:59', subject: 'Ошибка' },
        { day: 2, start: '10:00', end: '10:00', subject: 'Нулевое время' },
        { day: 0, start: '06:00', end: '08:00', subject: 'После смены' },
    ]; assert.equal(api.validSchedule(slots, true).length, 2); assert.equal(api.validSchedule(slots, false).length, 1);
});
test('refreshing adult schedule preserves work instead of creating student classes', async () => {
    const { api, s } = harness(); api.model(async () => JSON.stringify([0, 1].map(day => ({ day, start: '21:00', end: '05:00', type: 'work', subject: 'Охрана' }))));
    await api.ACT.regenSchedule({}, null, s); assert.equal(s.schedule.length, 2); assert.ok(s.schedule.every(c => c.type === 'work'));
});
test('disabled lore is excluded; long lore and macros are preserved', async () => {
    const { api, c } = harness(); c.characters[0].data = { extensions: { world: 'main' }, character_book: { entries: [
        { keys: ['активный'], content: '{{user}} и {{char}} — жители.' },
        { keys: ['клуб'], content: 'EMBEDDED_DISABLED', enabled: false },
    ] } };
    c.loadWorldInfo = async () => ({ entries: { a: { key: ['клуб'], content: 'Описание '.repeat(800) + 'LORE_TAIL' }, b: { key: ['клуб'], content: 'EXTERNAL_DISABLED', disable: true } } });
    const result = await api.loreText(); assert.ok(result.includes('LORE_TAIL')); assert.ok(result.includes('Ариша и Леон'));
    assert.ok(!result.includes('EMBEDDED_DISABLED')); assert.ok(!result.includes('EXTERNAL_DISABLED'));
});
test('selected global, extra character and persona books are read once; unrelated books excluded', async () => {
    const { api, c } = harness(); const loaded = [];
    c.characters[0].data.extensions = { world: 'card' }; c.chatMetadata.world_info = 'chat';
    c.powerUserSettings = { persona_description_lorebook: 'persona' };
    api.worldInfo({ selected_world_info: ['global', 'card'], world_info: { charLore: [{ name: 'Leon', extraBooks: ['extra', 'global'] }, { name: 'Other', extraBooks: ['unrelated'] }] } });
    c.loadWorldInfo = async name => { loaded.push(name); return { entries: { x: { key: ['Ирина'], content: `${name}: Ирина разговаривает сдержанно.` } } }; };
    const lore = await api.loreFor('Ирина', { full: true, exactKeys: true });
    assert.equal(loaded.length, 5); assert.ok(loaded.includes('global') && loaded.includes('persona') && loaded.includes('extra'));
    assert.ok(!loaded.includes('unrelated')); assert.ok(lore.includes('global: Ирина'));
});
test('studio, car return dates, flight return dates and invalid calendar dates', () => {
    const { api, s, set } = harness(); api.ui.bk = 'flat'; set('sh-bk-rooms', 0); set('sh-bk-deal', 'buy');
    const studio = api.bookingDraft(s); assert.equal(studio.price, 150000); assert.ok(studio.title.includes('студия'));
    api.ui.bk = 'car'; set('sh-bk-in', '2028-10-05'); set('sh-bk-out', ''); assert.ok(api.bookingDraft(s).need);
    set('sh-bk-out', '2028-10-04'); assert.ok(api.bookingDraft(s).need);
    set('sh-bk-out', '2028-10-07'); assert.ok(!api.bookingDraft(s).need);
    api.ui.bk = 'flight'; set('sh-bk-dest', 'Париж'); set('sh-bk-dep', '2028-10-07'); set('sh-bk-ret', '2028-10-06'); assert.ok(api.bookingDraft(s).need);
    assert.ok(Number.isNaN(api.dayOf('2028-02-31'))); assert.ok(Number.isFinite(api.dayOf('2028-02-29')));
});
test('owner acceptance completes booking even when personal DM is blocked by scene', async () => {
    const { api, s, set } = harness(); api.ui.bk = 'flat'; set('sh-bk-rooms', 0); set('sh-bk-deal', 'rent'); set('sh-bk-in', '2028-10-05'); set('sh-bk-out', '2028-10-06');
    api.scene(async () => false); api.model(async () => JSON.stringify({ accept: true, owner: 'Ирина', reply: 'Согласна.' }));
    const balance = s.wallet.balance; await api.ACT.book({}, null, s);
    assert.equal(s.bookings.length, 1); assert.equal(s.bookings[0].status, 'ok'); assert.equal(s.wallet.balance, balance - 300);
    assert.equal(s.threads[0].msgs.length, 0);
});
test('missing owner decision does not fabricate a booking or refusal', async () => {
    const { api, s, set } = harness(); api.ui.bk = 'resort'; set('sh-bk-in', '2028-10-05'); set('sh-bk-out', '2028-10-06'); api.model(async () => '{}');
    const balance = s.wallet.balance; await api.ACT.book({}, null, s); assert.equal(s.bookings.length, 0); assert.equal(s.wallet.balance, balance);
});
test('grocery/service delivery does not become a parcel for undefined; parcels notify once', () => {
    const { api, s } = harness(); s.social.questDay = '2028-10-2';
    s.orders = ['grocery', 'service', 'food', 'parcel'].map((kind, i) => ({ id: i, kind, title: 'Заказ', to: kind === 'parcel' ? 'Ирина' : undefined, eta: s.clock.t - 1000 }));
    api.tick(); const notes = s.notes.map(n => n.text); assert.ok(!notes.some(t => t.includes('undefined')));
    assert.equal(s.orders.filter(o => o.notified).length, 1); api.tick(); assert.equal(s.notes.filter(n => n.text.includes('Посылка')).length, 1);
});
test('work task probability is sampled once per completed shift', () => {
    const { api, s, math } = harness(); s.social.questDay = '2028-10-2'; s.enforceFrom = s.clock.t - 4 * 3600000;
    s.schedule = [{ id: 'shift', day: 0, start: '09:00', end: '10:00', type: 'work', subject: 'Охрана' }]; s.attendance['shift@2028-10-2'] = 'present';
    math.random = () => 0.99; api.tick(); math.random = () => 0.1; api.tick(); assert.equal(s.tasks.length, 0);
});
test('overdue study task generates teacher warning rather than employer warning', async () => {
    const { api, s } = harness(); const prompts = []; s.social.questDay = '2028-10-2'; s.profile.profession = 'Студент';
    s.tasks = [{ id: 'task', subject: 'Математика', title: 'Решение задачи', deadline: s.clock.t - 1000 }];
    api.model(async prompt => { prompts.push(prompt); return '{}'; }); api.tick(); await api.queue();
    assert.ok(prompts.some(p => p.includes('преподаватель или куратор')));
});
test('skipped queued jobs release story and daily quest flags after switching chats', async () => {
    const { api, s, c, switchChat } = harness(); const blocker = defer(), started = defer();
    api.enqueue(s, async () => { started.resolve(); await blocker.promise; }); await started.promise;
    const session = api.storySession(s); api.queueStorySync(s, session); assert.equal(session.queued, true);
    assert.equal(api.refreshQuests(s), true); const originalMetadata = c.chatMetadata;
    switchChat(); blocker.resolve(); await api.queue(); await Promise.resolve();
    assert.equal(session.queued, false); assert.equal(s.social.questsLoading, false); assert.equal(s.social.questDay, '');
    c.chatId = 'audit'; c.chatMetadata = originalMetadata;
    assert.equal(api.refreshQuests(s), true); await api.queue(); assert.equal(s.social.quests.length, 3); assert.ok(s.social.quests.some(q => q.k === 'rp'));
});
test('persisted loading flag and exhausted fallback history recover to three quests with RP', async () => {
    const { api, s } = harness(); s.social.questDay = '2028-10-2'; s.social.questsLoading = true;
    s.social.questHistory = ['Щедрое сердце', 'Последнее слово', 'Операция «Чистота»', 'Генеральная уборка', 'Образцовый работник', 'Долг библиотеке', 'Новые связи'];
    api.model(async () => '[]'); assert.equal(api.refreshQuests(s), true); await api.queue();
    assert.equal(s.social.questsLoading, false); assert.equal(s.social.quests.length, 3); assert.ok(s.social.quests.some(q => q.k === 'rp'));
});
test('three model quests without RP are repaired to include RP', async () => {
    const { api, s } = harness(); api.model(async () => JSON.stringify(['like', 'follow', 'post'].map(k => ({ k, title: k }))));
    api.refreshQuests(s); await api.queue(); assert.equal(s.social.quests.length, 3); assert.ok(s.social.quests.some(q => q.k === 'rp'));
});
test('private quarrel stays private until NPC actually publishes', async () => {
    const { api, s } = harness(); const th = { id: 'npc', kind: 'dm', name: 'Ирина', rel: -61, msgs: [{ me: true, text: 'Мы поссорились.', t: 1 }] }; s.threads = [th];
    api.model(async () => '{"text":""}'); api.updateRel(s, th, 0, false); await api.queue();
    assert.ok(!api.buildInjection().includes('Общеизвестно в городе: публичный бифф'));
    th.beef = false; api.model(async () => '{"text":"У меня есть претензии."}'); api.updateRel(s, th, 0, false); await api.queue();
    assert.ok(api.buildInjection().includes('Общеизвестно в городе: публичный бифф'));
});
test('automatic quest posts reuse stored NPC voice', async () => {
    const { api, s } = harness(); s.npcVoices = [{ id: 'voice', name: 'Ирина', style: 'FIXED_HOOK_VOICE: деловые короткие фразы.', emoji: 'never', slang: 'never', examples: [], createdAt: 1 }];
    let prompt = ''; api.model(async p => { prompt = p; return 'Встреча состоится в десять.'; });
    api.fireHook(s, { t: 'Встреча', desc: 'Договорись о встрече.', trigger: 'post', hook: { type: 'post', author: 'Ирина' } }, 'Я предложила встречу.'); await api.queue();
    assert.ok(prompt.includes('FIXED_HOOK_VOICE')); assert.equal(s.feed.length, 1);
});
test('warm score, positive DM and forged proof cannot clear a saved conflict', async () => {
    const { api, s, c } = harness(); const th = { id: 'npc', name: 'Ирина', kind: 'dm', known: true, rel: -30, msgs: [{ me: true, text: 'Добрый день.', t: 1 }], relStoryAccepted: true, conflict: { why: 'Сломанное обещание', source: 'story', low: -30, storyIndex: 1 } }; s.threads = [th];
    api.model(async p => { assert.ok(p.includes('Сломанное обещание')); return '{"known":true,"rel":40,"status":"друзья","note":"Вежливо поговорили"}'; }); await api.syncRel(s, th); assert.ok(th.conflict);
    api.updateRel(s, th, 6, false); assert.ok(th.conflict); assert.ok(!s.notes.some(n => n.text.includes('помирились')));
    api.model(async () => '{"known":true,"rel":60,"conflictChange":{"state":"resolved","source":"story","evidence":"Они извинились и помирились"}}'); await api.syncRel(s, th); assert.ok(th.conflict);
    c.chat.push({ name: 'Леон', mes: 'Ариша и Ирина извинились и помирились.' });
    api.model(async () => '{"known":true,"rel":60,"conflictChange":{"state":"resolved","source":"story","evidence":"Ариша и Ирина извинились и помирились."}}'); await api.syncRel(s, th); assert.equal(th.conflict, null);
    c.chat.pop(); api.model(async () => '{"known":true,"rel":50,"conflictChange":{"state":"unchanged"}}'); await api.syncRel(s, th);
    assert.equal(th.conflict.why, 'Сломанное обещание'); assert.equal(th.reconciled, null);
});
test('stale AI actions cannot mutate old chat state or active UI', async () => {
    for (const action of ['genMenu', 'genGroceries', 'genMarket', 'genEvents', 'loadAbilities', 'loadSpecies', 'groups', 'regenSchedule', 'tutor', 'orderSvc']) {
        const { api, s, c, set, switchChat } = harness(); set('sh-tutor', 'Математика'); set('sh-svc-text', 'Нужна помощь.'); api.ui.svc = 'repair';
        // Use an existing service key which is answered by an AI executor.
        if (action === 'orderSvc') api.ui.svc = 'tutor';
        const ready = defer(), pending = defer(); let requested = false;
        api.model(() => { requested = true; ready.resolve(); return pending.promise; });
        const before = JSON.stringify(s); const run = api.ACT[action]({}, null, s);
        if (!requested) await Promise.resolve();
        if (!requested && ['loadAbilities', 'loadSpecies', 'genEvents', 'regenSchedule'].includes(action)) await Promise.resolve();
        await Promise.race([ready.promise, Promise.resolve(run).then(() => { throw new Error(`${action} did not request AI`); })]); switchChat(); api.ui.view = 'notes'; api.ui.param = 'new';
        pending.resolve(JSON.stringify([{ name: 'Новый', title: 'Предмет', price: 100, day: 0, start: '09:00', end: '10:00', subject: 'Математика' }])); await run;
        assert.equal(JSON.stringify(s), before, action); assert.equal(api.ui.view, 'notes', action); assert.equal(api.ui.param, 'new', action);
        assert.equal(api.S().threads.length, 0, action);
    }
});
test('missing AI grade does not fabricate a grade or pay a reward', async () => {
    const { api, s, set } = harness(); set('sh-ans', 'Содержательный ответ. '.repeat(30)); s.tasks = [{ id: 'task', title: 'Задание', subject: 'Математика', desc: 'Решить задачу', deadline: s.clock.t + 100000, extra: true }];
    api.model(async () => '{}'); const balance = s.wallet.balance; await api.ACT.submit({ id: 'task' }, null, s);
    assert.ok(!s.tasks[0].done); assert.equal(s.grades.length, 0); assert.equal(s.wallet.balance, balance);
});
test('non-finite model prices are discarded and unknown age is not upgraded to adult', async () => {
    const { api, s } = harness(); api.model(async () => '[{"title":"Bad","price":"Infinity"},{"title":"Good","price":100}]'); await api.ACT.genMenu({}, null, s);
    assert.equal(s.menu.length, 1); assert.equal(s.menu[0].title, 'Good');
    s.lorePeople = [{ name: 'Катя', role: 'minor', age: 16, bio: 'Школьница' }];
    api.model(async () => '[{"name":"Катя","age":25},{"name":"Неизвестный возраст"},{"name":"Ольга","age":27}]'); await api.ACT.genDating({}, null, s);
    assert.equal(s.dating.profiles.length, 1); assert.equal(s.dating.profiles[0].name, 'Ольга');
});
test('malformed private JSON is not displayed as a literal chat message', async () => {
    const { api, s } = harness(); const th = { name: 'Ирина', kind: 'dm', msgs: [{ me: true, text: 'Добрый день.', t: 1 }] }; s.threads = [th];
    api.model(async p => p.startsWith('Проверка текущей сцены') ? '{"state":"apart","evidence":""}' : '{"delta":6}');
    await api.reply(s, th); assert.ok(!th.msgs.some(m => !m.sys && !m.me));
});
test('metadata save starts in the active chat without a cancellable local delay', () => {
    const { api, s, calls, switchChat } = harness(); api.save(s); switchChat(); assert.deepEqual(calls, ['audit']);
});
test('old busy request cannot keep or clear the overlay of a different chat', async () => {
    const { api, switchChat } = harness(); const first = defer(), second = defer();
    const old = api.withBusy('old', () => first.promise); switchChat(); api.onChatChanged();
    const current = api.withBusy('new', () => second.promise); assert.equal(api.ui.busy, 'new');
    first.resolve(); await old; assert.equal(api.ui.busy, 'new'); second.resolve(); await current; assert.equal(api.ui.busy, '');
});
test('expired or already completed task cannot be graded by an in-flight answer', async () => {
    const { api, s, set } = harness(); const ready = defer(), pending = defer(); set('sh-ans', 'Достаточно длинный ответ на задание.');
    const task = { id: 'task', title: 'Задание', subject: 'Математика', deadline: s.clock.t + 10000, extra: true }; s.tasks = [task];
    api.model(() => { ready.resolve(); return pending.promise; }); const run = api.ACT.submit({ id: 'task' }, null, s); await ready.promise;
    task.expired = true; pending.resolve('{"grade":5,"comment":"Хорошо"}'); await run; assert.equal(s.grades.length, 0); assert.ok(!task.done);
});
test('zero-day appointment stays today and invalid appointment time uses a valid fallback', () => {
    const { api, s } = harness(); const strike = { id: 'strike', reason: 'Нарушение' };
    api.applyConsequence(s, strike, { from: 'Отдел полиции', letter: 'Приходите сегодня.', appointment: { inDays: 0, time: '17:30', place: 'Отдел' } });
    assert.equal(new Date(s.meetings[0].at).getDate(), 2); assert.equal(new Date(s.meetings[0].at).getHours(), 17);
    api.applyConsequence(s, strike, { appointment: { inDays: 0, time: '99:99' } }); assert.equal(new Date(s.meetings[1].at).getHours(), 15);
});
test('zero police detection probability does not turn into fifty percent', async () => {
    const { api, s, c, math } = harness(); c.extensionSettings.cityhub.crimeScan = true; s.crimeScanAt = 2; math.random = () => 0;
    api.model(async () => '{"offense":true,"type":"Вандализм","desc":"Разбила стекло","weight":1,"caught":0}'); await api.scanCrimes(s);
    assert.equal(s.strikes.length, 0); assert.ok(s.notes.some(n => n.text.includes('никто не заметил')));
});
test('empty AI response cannot deny a valid attendance excuse', async () => {
    const { api, s, set } = harness(); s.schedule = [{ id: 'shift', day: 0, start: '13:00', end: '14:00', type: 'work', subject: 'Охрана' }]; set('sh-excuse', 'Заболела и обращаюсь к врачу.');
    api.model(async () => '{}'); await api.ACT.excuse({ key: 'shift@2028-10-2' }, null, s); assert.equal(s.excuses['shift@2028-10-2'], undefined); assert.equal(s.attendance['shift@2028-10-2'], undefined);
});
test('all screens render and escape stored user/model text', () => {
    const { api, s } = harness(); const attack = '<img src=x onerror=alert(1)>'; s.profile.name = attack; s.profile.bio = attack;
    s.feed = [{ id: 'post', author: attack, text: attack, t: Date.now(), comments: [], likes: 1, channel: 'general' }];
    s.threads = [{ id: 'dm', name: attack, kind: 'dm', msgs: [{ text: attack, t: 1 }], rel: 0 }];
    for (const tab of Object.keys(api.TABS)) { api.ui.tab = tab; api.ui.view = null; const html = api.screenHTML(); assert.ok(typeof html === 'string'); assert.ok(!html.includes(attack), tab); }
    for (const view of Object.keys(api.VIEWS).filter(v => !['log', 'colors'].includes(v))) { api.ui.view = view; api.ui.param = view === 'thread' ? 'dm' : view === 'post' ? 'post' : 'missing'; const html = api.screenHTML(); assert.ok(typeof html === 'string'); assert.ok(!html.includes(attack), view); }
});

(async () => {
    let failed = 0;
    for (const [name, run] of tests) { let timeout; try { await Promise.race([Promise.resolve().then(run), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Scenario timed out")), 2000); })]); console.log(`PASS: ${name}`); } catch (e) { failed++; console.error(`FAIL: ${name}\n${e.stack}`); } finally { clearTimeout(timeout); } }
    console.log(`${tests.length - failed}/${tests.length} audit scenarios passed`);
    if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
