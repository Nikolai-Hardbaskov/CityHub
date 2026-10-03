const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8').replace('    globalThis.CityHub = {', `
    globalThis.test = { S, postHTML, residentVerified, syncResidentBadges, datingTab, dprofileView };
    render = () => {}; updateInjection = () => {}; globalThis.CityHub = {`);
function harness(metadata = {}) {
    const c = { characterId: 0, chatId: 'badges', name1: 'Ариша', name2: 'Леон С. Кеннеди',
        characters: [{}], chat: [], chatMetadata: metadata, extensionSettings: { cityhub: {} } };
    const env = { console, Date, Math, JSON, Promise, Map, Set, WeakMap, WeakSet, SillyTavern: { getContext: () => c },
        window: { addEventListener() {} }, document: { getElementById: () => null }, jQuery() {},
        setTimeout() {}, clearTimeout() {}, setInterval() {} };
    vm.createContext(env); vm.runInContext(source, env);
    return { api: env.test, c, s: env.test.S() };
}
const post = (author, verified, id) => ({ author, verified, id, text: 'Публикация', t: 1, comments: [], channel: 'general' });
const badge = html => html.includes('fa-circle-check sh-verified');
let { api, c, s } = harness();
s.feed = [post('Леон С. Кеннеди', true, 'a'), post('Леон С. Кеннеди', false, 'b')]; api.S();
assert.ok(s.feed.every(p => badge(api.postHTML(p, s))), 'screenshot: same resident, same badge');
assert.equal(s.residentBadges.length, 1);
// No model response can switch an established status; it survives feed pruning and reload.
s.feed = [post('Леон С. Кеннеди', false, 'new')]; api.S(); assert.ok(badge(api.postHTML(s.feed[0], s)));
s.feed = []; ({ api, c, s } = harness(JSON.parse(JSON.stringify(c.chatMetadata))));
s.feed = [post('Leon S. Kennedy', false, 'alias')]; api.S(); assert.ok(badge(api.postHTML(s.feed[0], s)));
assert.equal(s.residentBadges.length, 1);
// First explicitly unverified account remains unverified despite a later generated true.
s.feed.push(post('Ирина Соколова', false, 'irina')); api.S();
s.feed.push(post('Ирина Соколова', true, 'irina-new')); api.S();
assert.ok(s.feed.filter(p => p.author === 'Ирина Соколова').every(p => !badge(api.postHTML(p, s))));
// Missing field on automated posts must not override an explicit false during migration.
({ api, c, s } = harness()); s.feed = [post('Ирина Соколова', undefined, 'auto'), post('Ирина Соколова', false, 'old')]; api.S();
assert.equal(api.residentVerified(s, 'Ирина Соколова'), false);
// Full/short and transliterated names share a record, but different surnames do not.
s.lorePeople = [{ name: 'Марвин Бранаг', aliases: ['Marvin Branagh'], role: 'adult', bio: '' }];
s.feed.push(post('Marvin Branagh', true, 'marvin'), post('Марвин', false, 'short'), post('Марк Смит', true, 'smith'), post('Марк Джонс', false, 'jones')); api.S();
assert.equal(api.residentVerified(s, 'Марвин Бранаг'), true); assert.equal(api.residentVerified(s, 'Марвин'), true);
assert.equal(api.residentVerified(s, 'Марк Смит'), true); assert.equal(api.residentVerified(s, 'Марк Джонс'), false);
// Dating views use the same persisted badge, including contradictory legacy records.
s.dating.profiles = [{ id: 'irina-profile', name: 'Ирина Соколова', age: 27, verified: true }]; api.S();
assert.ok(!badge(api.datingTab(s))); assert.ok(!api.dprofileView(s, 'irina-profile').includes('верифицирован(а)'));
s.dating.profiles = [{ id: 'marvin-profile', name: 'Марвин Бранаг', age: 30, verified: false }]; api.S();
assert.ok(badge(api.datingTab(s))); assert.ok(api.dprofileView(s, 'marvin-profile').includes('верифицирован(а)'));
// Existing badge records merge when previously unknown aliases become established.
s.residentBadges.push({ name: 'Marvin Branagh', verified: false }); api.S();
assert.equal(s.residentBadges.filter(r => r.name === 'Марвин Бранаг').length, 1);
assert.equal(api.residentVerified(s, 'Марвин Бранаг'), true);
// The user's badge still depends on level; data from another chat cannot leak in.
const mine = { ...post('Ариша', true, 'mine'), mine: true }; s.social.authority = 0; assert.equal(badge(api.postHTML(mine, s)), false);
s.social.authority = 140; assert.equal(badge(api.postHTML(mine, s)), true);
c.chatId = 'other'; c.chatMetadata = {}; const other = api.S(); other.feed = [post('Марвин Бранаг', false, 'other')]; api.S();
assert.equal(api.residentVerified(other, 'Марвин Бранаг'), false); assert.equal(api.residentVerified(s, 'Марвин Бранаг'), true);
console.log('PASS: screenshot badges; stable true/false; legacy migration; reload and feed pruning; aliases and homonyms; dating consistency; own level; chat isolation');
