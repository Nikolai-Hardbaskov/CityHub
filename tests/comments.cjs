const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const input={value:'',focus(){}};
const c={characterId:0,chatId:'comments',name1:'Игрок',name2:'Персонаж',chat:[],chatMetadata:{},characters:[{}],extensionSettings:{cityhub:{}}};
const env={console,Date,Math,JSON,Promise,Map,Set,WeakMap,WeakSet,toastr:{info(){},success(){},warning(){},error(){}},SillyTavern:{getContext:()=>c},
 window:{addEventListener(){}},document:{getElementById:id=>id==='sh-cmt'?input:null},jQuery(){},setTimeout(){},clearTimeout(){},setInterval(){}};
vm.createContext(env);
let source=fs.readFileSync(require('node:path').join(__dirname, '..', 'index.js'),'utf8').replace('    globalThis.CityHub = {',`
 globalThis.test={checkCommentQuests,makeQuest,questEvent,stripMention,commentHTML,normalizeMentions,model:fn=>aiJSON=fn};
 save=()=>{};render=()=>{};
 globalThis.CityHub = {`);
vm.runInContext(source,env);
const api=env.test,s=env.CityHub.state();s.auth=true;
const post={id:'sale',author:'Кендо',text:'Распродажа у Кендо в субботу!',comments:[
 {id:'motor',author:'Мотолюбитель',text:'Какие мотоциклы лучше для новичка?',t:1},
 {id:'sale-comment',author:'Покупатель',text:'Какие скидки будут на распродаже?',t:1}]};
const other={id:'other',author:'Сосед',text:'Ещё один пост',comments:[]};s.feed=[post,other];
const quest=(id,k,desc,n=1,target)=>({id,k,t:id,desc,n,p:0,done:false,r:{authority:1,money:10},...(target?{target}:{})});
let prompts=[];
api.model(async prompt=>{
 prompts.push(prompt);
 if(!prompt.startsWith('Проверь выполнение заданий'))return [];
 return [
 {id:'legacy-sale',matched:false,evidence:''},
 {id:'general-reply',matched:true,evidence:'Спасибо за совет про мотоцикл!'},
 // Even an erroneous model vote cannot bypass an exact comment/post target.
 {id:'target-sale',matched:true,evidence:'Спасибо за совет про мотоцикл!'},
 {id:'wrong-post',matched:true,evidence:'Спасибо за совет про мотоцикл!'}];
});
(async()=>{
 s.social.quests=[quest('legacy-sale','comment','Оставь комментарий про распродажу у Кендо'),
 quest('general-reply','reply','Ответь на два чужих комментария',2),
 quest('target-sale','reply','Ответь Покупателю о скидках',1,{postId:'sale',commentId:'sale-comment'}),
 quest('wrong-post','comment','Прокомментируй другой пост',1,{postId:'other'})];
 api.questEvent(s,'comment',1,'','Комментарий');assert.equal(s.social.quests[0].p,0,'generic action cannot credit thematic quest');
 env.CityHub._act.replyTo({name:'@@Мотолюбитель',id:'motor',post:'sale'});
 input.value='Спасибо за совет про мотоцикл!';await env.CityHub._act.comment({id:'sale'},null,s);
 const mine=post.comments.find(x=>x.mine);
 assert.equal(mine.replyToId,'motor');assert.equal(mine.replyTo,'Мотолюбитель');
 assert.equal(s.social.quests[0].p,0);assert.equal(s.social.quests[1].p,1);
 assert.equal(s.social.quests[2].p,0);assert.equal(s.social.quests[3].p,0);
 const prompt=prompts.find(x=>x.startsWith('Проверь выполнение заданий'));
 assert.ok(prompt.includes('Какие мотоциклы лучше для новичка?'));
 assert.ok(!prompt.includes('"id":"target-sale"'));assert.ok(!prompt.includes('"id":"wrong-post"'));
 await api.checkCommentQuests(s,post,mine);assert.equal(s.social.quests[1].p,1,'same comment credited once');
 const saleReply={id:'real-sale',author:s.profile.name,text:'Будут ли скидки на распродаже?',replyTo:'Покупатель',replyToId:'sale-comment',mine:true};
 post.comments.push(saleReply);
 api.model(async()=>[{id:'legacy-sale',matched:true,evidence:'скидки на распродаже'},
 {id:'target-sale',matched:true,evidence:'скидки на распродаже'}]);
 await api.checkCommentQuests(s,post,saleReply);
 assert.equal(s.social.quests[0].done,true);assert.equal(s.social.quests[2].done,true);
 const balance=s.wallet.balance;await api.checkCommentQuests(s,post,saleReply);assert.equal(s.wallet.balance,balance);
 assert.equal(api.makeQuest({k:'reply',target:{postId:'missing'}},s),null);
 assert.equal(api.makeQuest({k:'reply',target:{postId:'sale',commentId:'missing'}},s),null);
 const bound=api.makeQuest({k:'reply',title:'Ответ',target:{postId:'sale',commentId:'motor'}},s);
 assert.equal(bound.target.commentId,'motor');
 s.social.quests=[quest('proof','comment','Оставь комментарий',2)];
 api.model(async()=>[{id:'proof',matched:true,evidence:'Несуществующий текст'}]);
 await api.checkCommentQuests(s,post,mine);assert.equal(s.social.quests[0].p,0,'fabricated evidence rejected');
 api.model(async()=>null);await api.checkCommentQuests(s,post,mine);assert.equal(s.social.quests[0].p,0,'missing result fails closed');
 let release,started;const wait=new Promise(r=>started=r);
 api.model(()=>{started();return new Promise(r=>release=r);});
 const pending=api.checkCommentQuests(s,post,mine);await wait;
 mine.text='Изменённый комментарий';release([{id:'proof',matched:true,evidence:'Спасибо за совет про мотоцикл!'}]);await pending;
 assert.equal(s.social.quests[0].p,0,'changed action invalidates pending result');
 assert.equal(api.stripMention('@@Кендо, @Кендо, Спасибо! @Друг','@@Кендо'),'Спасибо! @Друг');
 assert.equal(api.stripMention('@Кендо','Кендо'),'');
 assert.equal(api.stripMention('Кендоран — другое имя','Кендо'),'Кендоран — другое имя');
 assert.equal(api.normalizeMentions('@@Кендо и @@@Друг'),'@Кендо и @Друг');
 const html=api.commentHTML({id:'old',author:'Пользователь',text:'@@Кендо, @Кендо, Спасибо! @Друг',replyTo:'@@Кендо',t:1,likes:0},post);
 assert.ok(!html.includes('@@'));assert.equal((html.match(/@Кендо/g)||[]).length,1);assert.ok(html.includes('@Друг'));
 const only=api.commentHTML({id:'only',author:'Пользователь',text:'@@Кендо',replyTo:'@Кендо',t:1,likes:0},post);
 assert.equal((only.match(/@Кендо/g)||[]).length,1);
 console.log('PASS: exact reply identity; unrelated motorcycle reply; valid sale reply; legacy semantics; target binding; dedup rewards; stale/missing evidence; old/new mention rendering');
})().catch(e=>{console.error(e);process.exitCode=1;});
