const {test}=require('node:test');const assert=require('node:assert/strict');
const uid='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222',token='33333333-3333-4333-8333-333333333333';
const vars={SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'test-public-key'}),SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_test_only'}),GEMINI_API_KEY:'test-ai-key',PHOTO_AI_ENABLED:'true'};
const req=(body={submission_id:sid,consent:true})=>new Request('https://test.supabase.co/functions/v1/validate-photo',{method:'POST',headers:{Authorization:'Bearer test.jwt.token','Content-Type':'application/json',Origin:'https://gannicus2026.github.io'},body:JSON.stringify(body)});
const json=data=>Response.json(data);
async function setup({environment={},verdict={accepted:true,confidence:.98,reason:'Objeto visible.'},image=[255,216,255,0],failProvider=false,busy=false}={}){
 const {createHandler}=await import('../supabase/functions/validate-photo/core.mjs');const calls=[];let finish;
 const handler=createHandler({env:name=>({...vars,...environment})[name],fetchFn:async(url,options={})=>{
  calls.push({url,options});if(url.endsWith('/auth/v1/user'))return json({id:uid});
  if(url.endsWith('/claim_photo_review'))return json(busy?{status:'processing',reason:'Ya se está analizando.'}:{status:'processing',token,photo_path:uid+'/photo.jpg',description:'Un billete de Brasil.'});
  if(url.includes('/storage/v1/object/'))return new Response(new Uint8Array(image));
  if(url.startsWith('https://generativelanguage.googleapis.com/'))return failProvider?new Response('',{status:429}):json({candidates:[{content:{parts:[{text:JSON.stringify(verdict)}]}}]});
  if(url.endsWith('/finish_photo_review')){finish=JSON.parse(options.body);return json({status:finish.p_error?'error':finish.p_accepted?'approved':'rejected',points:finish.p_accepted?10:0})}
  throw new Error('Unexpected network access in test: '+url);
 }});return {handler,calls,get finish(){return finish}};
}
test('AI disabled never sends a photo to the external provider',async()=>{
 const a=await setup({environment:{PHOTO_AI_ENABLED:'false'}});const response=await a.handler(req());assert.equal(response.status,503);
 assert.equal(a.calls.length,1);assert.match(a.calls[0].url,/auth\/v1\/user$/);
});
test('missing session is rejected before storage or provider access',async()=>{
 const a=await setup();const response=await a.handler(new Request('https://test/functions',{method:'POST'}));assert.equal(response.status,401);assert.equal(a.calls.length,0);
});
test('consent is required before claiming a photograph',async()=>{
 const a=await setup();const response=await a.handler(req({submission_id:sid,consent:false}));assert.equal(response.status,400);assert.equal(a.calls.length,1);
});
test('matching photograph is scored only through the server completion RPC',async()=>{
 const a=await setup();const response=await a.handler(req({submission_id:sid,consent:true,accepted:true,points:99999}));assert.equal(response.status,200);assert.equal(a.finish.p_accepted,true);assert.equal(a.finish.p_confidence,.98);
 assert.equal(a.calls.filter(x=>x.url.includes('googleapis.com')).length,1);assert.equal((await response.json()).points,10);
 const provider=JSON.parse(a.calls.find(x=>x.url.includes('googleapis.com')).options.body);assert.equal(JSON.stringify(provider).includes(uid),false);
});
test('low-confidence model approval is rejected without awarding points',async()=>{
 const a=await setup({verdict:{accepted:true,confidence:.6,reason:'Quizás.'}});await a.handler(req());assert.equal(a.finish.p_accepted,false);
});
test('invalid image data never reaches Google',async()=>{
 const a=await setup({image:[1,2,3]});const response=await a.handler(req());assert.equal(response.status,503);assert.equal(a.calls.some(x=>x.url.includes('googleapis.com')),false);assert.equal(a.finish.p_error,true);
});
test('quota failure saves a retryable error and never accepts evidence',async()=>{
 const a=await setup({failProvider:true});const response=await a.handler(req());assert.equal(response.status,503);assert.equal(a.finish.p_accepted,false);assert.equal(a.finish.p_error,true);
});
test('concurrent duplicate analysis does not call the provider twice',async()=>{
 const a=await setup({busy:true});const response=await a.handler(req());assert.equal((await response.json()).status,'processing');assert.equal(a.calls.some(x=>x.url.includes('googleapis.com')),false);
});
test('readiness probe checks provider availability without transmitting photos or secrets in the result',async()=>{
 const {createHandler}=await import('../supabase/functions/validate-photo/core.mjs');let calls=0;
 const handler=createHandler({env:name=>vars[name],fetchFn:async(url,options)=>{calls++;assert.match(url,/\/models\/gemini-2\.5-flash-lite$/);assert.equal(options.body,undefined);return Response.json({error:{status:'INVALID_ARGUMENT',details:[{reason:'API_KEY_INVALID'}]}},{status:400})}});
 const response=await handler(new Request('https://test/functions'));const data=await response.json();assert.equal(data.connection_ok,false);assert.equal(data.provider_code,'API_KEY_INVALID');assert.equal(JSON.stringify(data).includes('test-ai-key'),false);
 await handler(new Request('https://test/functions'));assert.equal(calls,1);
});
