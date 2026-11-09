const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8').replace('if(configured)session();','');
function app({hash='',search='',session=null,admin=false,from=null,rpc=null,auth={}}={}){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:'',textContent:'',disabled:false,checked:false,querySelectorAll:()=>[],focus(){},reset(){element('newPassword').value='';element('confirmPassword').value=''},reportValidity:()=>true});return elements.get(id)};
 const storage=new Map();let listener,updates=0,signouts=0;
 const db={auth:{onAuthStateChange:fn=>{listener=fn},getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session?.user}}),updateUser:async()=>{updates++;return{}},signOut:async()=>{signouts++;session=null;listener('SIGNED_OUT');return{}},resetPasswordForEmail:async()=>({})},rpc:async()=>({data:admin})};
 Object.assign(db.auth,auth);if(from)db.from=from;if(rpc)db.rpc=rpc;
 const context=vm.createContext({window:{supabase:{createClient:()=>db},scrollTo(){}},document:{getElementById:element,querySelectorAll:()=>[]},location:{hash,search,href:'https://example.test/Pilots-Challenge/'+search+hash,pathname:'/Pilots-Challenge/',origin:'https://example.test'},history:{replaceState(){}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},URL,URLSearchParams,console,confirm:()=>true,alert:()=>{}});
 vm.runInContext(source,context);
 return {element,run:code=>vm.runInContext(code,context),event:(e,s)=>listener(e,s),updates:()=>updates,signouts:()=>signouts};
}
test('expired recovery never enables password update',async()=>{
 const a=app({hash:'#type=recovery&error=access_denied'});await a.run('session()');
 assert.equal(a.element('passwordRecovery').hidden,false);assert.equal(a.element('savePassword').disabled,true);
 await a.element('newPasswordForm').onsubmit({preventDefault(){}});assert.equal(a.updates(),0);
});
test('recovery event takes priority and rejects mismatched passwords',async()=>{
 const session={user:{id:'admin',is_anonymous:false}};const a=app({session});
 a.event('PASSWORD_RECOVERY',session);await a.run('session()');
 assert.equal(a.element('passwordRecovery').hidden,false);assert.equal(a.element('admin').hidden,true);
 a.element('newPassword').value='test-only-password';a.element('confirmPassword').value='different-password';
 await a.element('newPasswordForm').onsubmit({preventDefault(){}});assert.equal(a.updates(),0);
 assert.match(a.element('recoveryMsg').textContent,/no coinciden/);
});
test('successful recovery updates through Auth and signs out',async()=>{
 const session={user:{id:'admin',is_anonymous:false}};const a=app({session});a.event('PASSWORD_RECOVERY',session);
 a.element('newPassword').value=a.element('confirmPassword').value='test-only-password';
 await a.element('newPasswordForm').onsubmit({preventDefault(){}});
 assert.equal(a.updates(),1);assert.equal(a.signouts(),1);assert.equal(a.element('adminLogin').hidden,false);
 assert.equal(a.element('newPassword').value,'');assert.equal(a.element('savePassword').disabled,true);
});
test('query flag alone does not authorize password update',async()=>{
 const a=app({search:'?recovery=1',session:{user:{id:'admin'}}});await a.run('session()');assert.equal(a.element('savePassword').disabled,true);
});
test('administrator session restores using server permission check',async()=>{
 const a=app({session:{user:{id:'admin',is_anonymous:false}},admin:true});a.run('loadAdmin=async()=>{}');await a.run('session()');
 assert.equal(a.element('admin').hidden,false);assert.equal(a.element('setup').hidden,true);
});
test('sign-out clears sensitive UI and session state',async()=>{
 const a=app();a.element('pending').textContent='private evidence';await a.run('closeSession()');
 assert.equal(a.element('pending').textContent,'');assert.equal(a.element('admin').hidden,true);assert.equal(a.element('setup').hidden,false);
});

test('list options preserve server answer keys for trivia and true/false',()=>{
 const a=app();
 assert.equal(a.run('optionsFor({game:"trivia",options:["One","Two","Three","Four"]})[1][0]'),'B');
 assert.equal(a.run('optionsFor({game:"tf",options:["Verdadero","Falso"]})[1][0]'),'F');
 assert.equal(a.run('optionsFor({game:"trivia",options:{A:"Legacy one",B:"Legacy two"}})[0][1]'),'Legacy one');
});
test('registration uses RPC and reuses interrupted anonymous sessions',async()=>{
 let calls=0,anonymousCalls=0;const user={id:'player',is_anonymous:true};
 const a=app({session:{user},rpc:async(name,args)=>{assert.equal(name,'register_participant');assert.equal(args.p_nickname,'Pilot');calls++;return{}},auth:{signInAnonymously:async()=>{anonymousCalls++;return{data:{user}}}}});
 a.run('loadParticipant=async()=>{}');a.element('nickname').value=' Pilot ';a.element('role').value='FO';
 await a.element('join').onclick();
 assert.equal(calls,1);assert.equal(anonymousCalls,0);
});
test('concurrent join taps send only one registration',async()=>{
 let release,calls=0;const pending=new Promise(resolve=>{release=resolve});
 const a=app({session:{user:{id:'player',is_anonymous:true}},rpc:async()=>{calls++;await pending;return{}}});a.run('loadParticipant=async()=>{}');
 a.element('nickname').value='Pilot';a.element('role').value='CT';
 const first=a.element('join').onclick();const second=a.element('join').onclick();
 await new Promise(resolve=>setImmediate(resolve));release();await Promise.all([first,second]);assert.equal(calls,1);
});
test('question editor saves array options, availability and server-compatible answer',async()=>{
 let saved;
 const a=app({from:table=>{assert.equal(table,'questions');return {insert:async row=>{saved=row;return{}}}}});a.run('loadAdmin=async()=>{}');
 for(const [id,value] of Object.entries({qGame:'trivia',qText:'Example',qCorrect:'C',qPoints:'10',qLevel:'2',optA:'One',optB:'Two',optC:'Three',optD:'Four'}))a.element(id).value=value;
 a.element('qActive').checked=false;await a.element('saveQuestion').onclick();
 assert.equal(Array.isArray(saved.options),true);assert.equal(saved.options[2],'Three');assert.equal(saved.correct_answer,'C');assert.equal(saved.active,false);
});
test('invalid question points are rejected before any write',async()=>{
 let writes=0;const a=app({from:()=>{writes++;return{}}});
 for(const [id,value] of Object.entries({qGame:'tf',qText:'Example',qCorrect:'V',qPoints:'1.5'}))a.element(id).value=value;
 await a.element('saveQuestion').onclick();assert.equal(writes,0);assert.match(a.element('qMsg').textContent,/entero/);
});
test('editing true/false and clearing restores usable trivia defaults',()=>{
 const a=app();a.run('editQuestion({id:"q",game:"tf",level:1,question:"Example",points:5,correct_answer:"F",active:false,options:["Verdadero","Falso"]})');
 assert.equal(a.element('optionFields').hidden,true);assert.equal(a.element('qLevel').disabled,true);
 a.run('clearQuestion()');assert.equal(a.element('qGame').value,'trivia');assert.equal(a.element('qLevel').disabled,false);assert.equal(a.element('optionFields').hidden,false);assert.equal(a.element('qActive').checked,true);
});
test('unsupported image types never reach Storage',async()=>{
 const a=app();a.element('photo-test').files=[{type:'image/heic',size:1000}];await a.run('uploadEvidence("test")');
 assert.match(a.element('upload-test').textContent,/JPG, PNG o WebP/);
});
test('ranking is deterministic for tied scores',()=>{
 const a=app();assert.equal(a.run('sortRanking([{nickname:"Zulu",role:"CT",points:10},{nickname:"Alpha",role:"FO",points:10}])[0].nickname'),'Alpha');
});
