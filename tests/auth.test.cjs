const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8').replace('if(configured)session();','');
function app({hash='',search='',session=null,admin=false,from=null,rpc=null,auth={},mediaDevices={}}={}){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:'',textContent:'',disabled:false,checked:false,querySelectorAll:()=>[],focus(){},reset(){element('newPassword').value='';element('confirmPassword').value=''},reportValidity:()=>true});return elements.get(id)};
 const storage=new Map();let listener,updates=0,signouts=0;
 const db={auth:{onAuthStateChange:fn=>{listener=fn},getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session?.user}}),updateUser:async()=>{updates++;return{}},signOut:async()=>{signouts++;session=null;listener('SIGNED_OUT');return{}},resetPasswordForEmail:async()=>({})},rpc:async()=>({data:admin})};
 Object.assign(db.auth,auth);if(from)db.from=from;if(rpc)db.rpc=rpc;
 const context=vm.createContext({navigator:{mediaDevices},window:{addEventListener(){},supabase:{createClient:()=>db},scrollTo(){}},document:{addEventListener(){},getElementById:element,querySelectorAll:()=>[]},location:{hash,search,href:'https://example.test/Pilots-Challenge/'+search+hash,pathname:'/Pilots-Challenge/',origin:'https://example.test'},history:{replaceState(){}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},URL,URLSearchParams,setInterval:()=>1,clearInterval(){},console,confirm:()=>true,alert:()=>{}});
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
 const a=app();a.run('capturedPhotos.set("test",{file:{type:"image/heic",size:1000}})');await a.run('uploadEvidence("test")');
 assert.match(a.element('upload-test').textContent,/JPG, PNG o WebP/);
});
test('ranking is deterministic for tied scores',()=>{
 const a=app();assert.equal(a.run('sortRanking([{nickname:"Zulu",role:"CT",points:10},{nickname:"Alpha",role:"FO",points:10}])[0].nickname'),'Alpha');
});

test('camera denial gives an actionable message without permitting gallery upload',async()=>{
 const a=app({mediaDevices:{getUserMedia:async()=>{throw new Error('denied')}}});
 await a.run('openCamera("test")');assert.match(a.element('upload-test').textContent,/permiso de cámara/);
 assert.doesNotMatch(source,/type="file"/);
});
test('camera stream resolved after leaving the page is stopped',async()=>{
 let resolve,stopped=0;
 const a=app({mediaDevices:{getUserMedia:()=>new Promise(r=>{resolve=r})}});
 a.run('participant={id:"p"}');const pending=a.run('openCamera("test")');a.run('closeGame()');
 resolve({getTracks:()=>[{stop(){stopped++}}]});await pending;assert.equal(stopped,1);
});
test('evidence cannot be uploaded without a live camera capture',async()=>{
 const a=app();await a.run('uploadEvidence("test")');assert.match(a.element('upload-test').textContent,/cámara/);
});
test('live camera capture stops the stream and enables evidence upload',async()=>{
 let stopped=0,requested,drawn=0;
 const video={videoWidth:1920,videoHeight:1080,play:async()=>{}};
 const shutter={},cancel={},upload={disabled:true};const photo={type:'image/jpeg',size:1000};
 const canvas={getContext:()=>({drawImage(){drawn++}}),toBlob:fn=>fn(photo),setAttribute(){}};
 const a=app({mediaDevices:{getUserMedia:async options=>{requested=options;return{getTracks:()=>[{stop(){stopped++}}]}}}});
 a.element('camera-test').querySelector=selector=>selector==='video'?video:selector==='[data-shutter]'?shutter:cancel;
 a.element('camera-test').appendChild=()=>{};a.element('game').querySelector=()=>upload;
 a.run('participant={id:"p"}');a.run('document.createElement=()=>({})');
 // Supply the canvas through a test-only bridge, without a file selector.
 a.element('canvasBridge').canvas=canvas;a.run('document.createElement=()=>document.getElementById("canvasBridge").canvas');
 await a.run('openCamera("test")');assert.equal(requested.audio,false);assert.equal(upload.disabled,true);
 await shutter.onclick();assert.equal(drawn,1);assert.equal(stopped,1);assert.equal(upload.disabled,false);
 assert.equal(a.run('capturedPhotos.get("test").file.type'),'image/jpeg');
});
test('block starts through server RPC and shows persisted elapsed time',async()=>{
 const calls=[];const state={questions:[{id:'q',game:'trivia',level:1,question:'Question',options:['One','Two','Three','Four']}],total:1,answered:0,elapsed_seconds:185,finished:false};
 const a=app({rpc:async(name,args)=>{calls.push({name,args});return{data:state}}});
 a.run('participant={id:"p"};currentGame="trivia"');await a.run('startQuestionSet(1)');
 assert.equal(calls[0].name,'start_block');assert.equal(calls[0].args.p_level,1);
 assert.equal(a.element('blockElapsed').textContent,'3:05');assert.match(a.element('game').innerHTML,/Tiempo del bloque/);
});
test('completion displays server bonus separately and does not calculate score in browser',async()=>{
 const state={questions:[{id:'q',game:'tf',level:1,question:'Question',options:['Verdadero','Falso']}],total:1,answered:0,elapsed_seconds:0,finished:false};
 const a=app({rpc:async name=>name==='start_block'?{data:state}:{data:{correct:true,points:10,block:{finished:true,correct:1,total:1,elapsed_seconds:93,base_points:10,bonus_points:5,bonus_eligible:true}}}});
 a.run('participant={id:"p"};currentGame="tf";refreshScore=async()=>{}');await a.run('startQuestionSet(1)');
 a.run('selectedAnswer="V"');await a.element('submitAnswer').onclick();
 assert.match(a.element('game').innerHTML,/Bono por tiempo: <b>\+5/);assert.match(a.element('game').innerHTML,/15 puntos/);
});
test('leaving while a block request is pending does not reopen the game',async()=>{
 let resolve;const a=app({rpc:()=>new Promise(r=>{resolve=r})});
 a.run('participant={id:"p"};currentGame="trivia"');const pending=a.run('startQuestionSet(1)');a.run('closeGame()');
 resolve({data:{finished:true,correct:1,total:1,base_points:10,bonus_points:5,elapsed_seconds:0}});await pending;
 assert.equal(a.element('game').hidden,true);assert.doesNotMatch(a.element('game').innerHTML||'',/Bloque terminado/);
});
