const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8').replace('    globalThis.CityHub = {', `
    globalThis.test = { S, commentThreads, bindCommentReplies, postView, aiComments, model: fn => aiJSON = fn };
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
let { api, c, s } = harness();
const comment = (id, author, replyTo = '', replyToId) => ({ id, author, replyTo, ...(replyToId === undefined ? {} : { replyToId }), text: id, t: 1 });
const p = { id: 'post', author: 'NPC', text: 'Пост', commentsLoaded: true, comments: [comment('tony', 'Тони'), comment('sheryl', 'Шерил'), comment('claire', 'Клэр', 'Тони'), comment('rick', 'Рик', 'Шерил'), comment('becky', 'Бекки')] }; s.feed = [p];
let rows = api.commentThreads(p);
assert.equal(rows.map(x => x.c.id).join(','), 'tony,claire,sheryl,rick,becky', 'screenshot branches corrected');
assert.equal(rows[1].parent.id, 'tony');
p.comments.push(comment('nested', 'Тони', 'Рик', 'rick'));
rows = api.commentThreads(p); assert.equal(rows.find(x => x.c.id === 'nested').depth, 2);
for (const author of ['NPC', 'Леон С. Кеннеди', s.profile.name]) {
 p.author = author; p.mine = author === s.profile.name;
 const html = api.postView(s, p.id); assert.ok(html.indexOf('data-comment-id="claire"') < html.indexOf('data-comment-id="sheryl"'));
 assert.ok(html.includes('В ответ Тони: «tony»'));
}
// Same author in several branches: names alone must never guess a parent.
p.comments.push(comment('tony2', 'Тони'), comment('ambiguous', 'Друг', 'Тони'));
api.commentThreads(p); assert.equal(p.comments.at(-1).replyToId, '');
const raw = [{id:'n1',author:'A',replyTo:'Тони',replyToId:'tony2'}, {id:'n2',author:'B',replyTo:'A',replyToId:'n1'}, {id:'n3',author:'C',replyTo:'Тони',replyToId:'missing'}];
const list = raw.map((x,i) => ({...x,id:'saved'+i})); api.bindCommentReplies(s,p,raw,list);
assert.equal(list[0].replyToId,'tony2'); assert.equal(list[1].replyToId,'saved0'); assert.equal(list[2].replyToId,'');
// Missing fields from an older model can use the exact active comment, not an arbitrary user's reply.
const fallback = [{author:'NPC',replyTo:'Тони'}]; const out = [{...fallback[0],id:'out'}]; api.bindCommentReplies(s,p,fallback,out,'tony2'); assert.equal(out[0].replyToId,'tony2');
const broken = {comments:[comment('a','A','B','b'),comment('b','B','A','a'),comment('self','C','C','self'),comment('orphan','D','X','deleted')]};
assert.equal(api.commentThreads(broken).length,4); assert.ok(api.commentThreads(broken).every(x=>x.depth===0));
const hidden = comment('hidden','H'); hidden.at=Date.now()+60000;
const delayed = {comments:[hidden,comment('visible','V','H','hidden')]}; assert.equal(api.commentThreads(delayed)[0].depth,0);
hidden.at=1; assert.equal(api.commentThreads(delayed)[1].depth,1);
const reload=JSON.parse(JSON.stringify(p)); assert.equal(api.commentThreads(reload).map(x=>x.c.id).join(','),api.commentThreads(p).map(x=>x.c.id).join(','));
// Verify the real AI mapping, including IDs in the prompt and same-batch links.
(async()=>{
 let prompt; api.model(async text=>{prompt=text;return raw.map(x=>({...x,text:'Ответ'}));});
 const result=await api.aiComments(s,p,'Ответь','этот комментарий','tony2');
 assert.ok(prompt.includes('id=tony2')); assert.ok(prompt.includes('replyToId'));
 assert.equal(result[0].replyToId,'tony2'); assert.equal(result[1].replyToId,result[0].id);
 console.log('PASS: screenshot branches; own/char/NPC posts; nested replies; repeated authors; model IDs; legacy migration; cycles/orphans; delayed visibility; reload');
})().catch(e=>{console.error(e);process.exitCode=1;});
