import {createHandler} from './core.mjs';
// POST authenticates the participant through Supabase Auth before accessing evidence.
Deno.serve(createHandler({env:(name:string)=>Deno.env.get(name)}));
