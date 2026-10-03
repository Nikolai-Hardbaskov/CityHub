const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8').replace('    globalThis.CityHub = {', `
    globalThis.test = { S, planLikes, tickLikes };
    render = () => {}; updateInjection = () => {}; globalThis.CityHub = {`);
function harness(metadata = {}) {
    const c = { characterId: 0, chatId: 'badges', name1: 'Ариша', name2: 'Леон С. Кеннеди',
        characters: [{}], chat: [], chatMetadata: metadata, extensionSettings: { cityhub: {} } };
    const env = { console, Date, Math: Object.assign(Object.create(Math), { random: () => 0.5 }), JSON, Promise, Map, Set, WeakMap, WeakSet, SillyTavern: { getContext: () => c },
        window: { addEventListener() {} }, document: { getElementById: () => null }, jQuery() {},
        setTimeout() {}, clearTimeout() {}, setInterval() {} };
    vm.createContext(env); vm.runInContext(source, env);
    return { api: env.test, c, s: env.test.S() };
}
const minute = 60000, now = 1800000000000;
const own = (id, t = now) => ({ id, author: 'Ариша', mine: true, t, likes: 0, comments: [] });
let { api, c, s } = harness(); s.social.followers = 40;
const p = own('post'); const parent = { id: 'npc', t: now - 10 * 86400000, likes: 200, comments: [] };
const comment = own('comment'); parent.comments.push(comment); s.feed = [p, parent];
assert.equal(api.tickLikes(s, now), true); assert.equal(p.likes, 0); assert.equal(comment.likes, 0);
api.tickLikes(s, now + 10 * minute);
assert.ok(p.likes > 0, 'small audience gets reactions without the floor(random * 1) trap');
assert.ok(comment.likes > 0, 'own comment under an old NPC post grows');
assert.equal(parent.likes, 200, 'NPC post unchanged');
const early = [p.likes, comment.likes]; api.tickLikes(s, now + 10 * minute);
assert.deepEqual([p.likes, comment.likes], early, 'same time cannot award twice');
// Strong reception helps, negative reception is not compulsory support.
const good = own('good'), bad = own('bad');
api.planLikes(s, good, null, { authority: 3, sentiment: 'positive' }, now);
api.planLikes(s, bad, null, { authority: -3, sentiment: 'negative' }, now);
assert.ok(good.engagement.target > bad.engagement.target * 5);
const target = good.engagement.target;
api.planLikes(s, good, null, { authority: -5, sentiment: 'negative' }, now);
assert.equal(good.engagement.target, target, 'score applied only once');
// One late tick and many frequent ticks reach the same result; manual/viral likes survive.
p.likes += 101; const replay = JSON.parse(JSON.stringify(p));
for (let t = now + 11 * minute; t <= now + 120 * minute; t += minute) api.tickLikes(s, t);
const incremental = p.likes; s.feed = [replay]; api.tickLikes(s, now + 120 * minute);
assert.equal(replay.likes, incremental);
api.tickLikes(s, now + 3 * 86400000); assert.equal(replay.likes, replay.engagement.target + 101);
const capped = replay.likes; api.tickLikes(s, now + 30 * 86400000); assert.equal(replay.likes, capped);
// State survives save/load; no fresh random plan or duplicate gains after reopening.
({ api, c, s } = harness(JSON.parse(JSON.stringify(c.chatMetadata))));
api.tickLikes(s, now + 30 * 86400000); assert.equal(s.feed[0].likes, capped);
const legacy = own('legacy', now - minute); legacy.likes = 7;
const archived = own('archive', now - 3 * 86400000);
s.feed = [legacy, archived]; api.tickLikes(s, now);
assert.equal(legacy.likes, 7); assert.equal(archived.engagement, undefined);
api.tickLikes(s, now + 60 * minute); assert.ok(legacy.likes > 7); assert.equal(archived.likes, 0);
// No reactions for another user's comments, or in another chat.
const npc = { id: 'npccomment', t: now, likes: 4 }; legacy.comments.push(npc);
api.tickLikes(s, now + 2 * 86400000); assert.equal(npc.likes, 4);
c.chatMetadata = {}; c.chatId = 'another'; assert.equal(api.S().feed.length, 0);
console.log('PASS: small audience; comments under NPC posts; score reception; capped growth; timer frequency independence; manual likes; reload; legacy migration; chat isolation');
