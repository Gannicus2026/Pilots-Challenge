// Status-only placeholder: never reads, downloads or transmits participant photographs.
// All validation requests are denied until the owner authorizes the external AI provider.
Deno.serve((req:Request)=>{
 const headers={'Access-Control-Allow-Origin':'https://gannicus2026.github.io','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-supabase-api-version','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method==='GET')return new Response(JSON.stringify({ready:false,provider:'Google Gemini',authorization_required:true,credential_configured:!!Deno.env.get('GEMINI_API_KEY')}),{headers});
 return new Response(JSON.stringify({code:'PROVIDER_AUTHORIZATION_REQUIRED',message:'La validación IA requiere que el organizador autorice y configure el proveedor. Tu foto está guardada.'}),{status:503,headers});
});
