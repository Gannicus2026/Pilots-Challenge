const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8').replace('if(configured)session();','');
function app({hash='',search='',session=null,admin=false}={}){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:'',textContent:'',disabled:false,reset(){element('newPassword').value='';element('confirmPassword').value=''},reportValidity:()=>true});return elements.get(id)};
 const storage=new Map();let listener,updates=0,signouts=0;
 const db={auth:{onAuthStateChange:fn=>{listener=fn},getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session?.user}}),updateUser:async()=>{updates++;return{}},signOut:async()=>{signouts++;session=null;listener('SIGNED_OUT');return{}},resetPasswordForEmail:async()=>({})},rpc:async()=>({data:admin})};
 const context=vm.createContext({window:{supabase:{createClient:()=>db}},document:{getElementById:element,querySelectorAll:()=>[]},location:{hash,search,href:'https://example.test/Pilots-Challenge/'+search+hash,pathname:'/Pilots-Challenge/',origin:'https://example.test'},history:{replaceState(){}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},URL,URLSearchParams,console,confirm:()=>true,alert:()=>{}});
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
