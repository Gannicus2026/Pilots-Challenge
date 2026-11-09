-- All users, submissions, reviews and scoring in this test are rolled back.
begin;
insert into auth.users(id,email) values(gen_random_uuid(),'photo-test@example.invalid') returning set_config('pilots.photo_user',id::text,true);
insert into public.participants(id,nickname,role) values(current_setting('pilots.photo_user')::uuid,'Photo test','FO');
select set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.photo_user'),'role','authenticated','is_anonymous',true)::text,true);
do $$
declare c uuid;s jsonb;j jsonb;result jsonb;before_points integer;after_points integer;oldpath text;i integer;
begin
 insert into public.challenges(description,points,active) values('Transaction-only photo challenge',17,true) returning id into c;
 oldpath:=auth.uid()::text||'/'||gen_random_uuid()||'.jpg';s:=public.save_photo_submission(c,oldpath);
 j:=public.claim_photo_review((s->>'id')::uuid,auth.uid());
 if not(j ? 'token') then raise exception 'Review claim failed';end if;
 if public.claim_photo_review((s->>'id')::uuid,auth.uid()) ? 'token' then raise exception 'Concurrent duplicate analysis accepted';end if;
 result:=public.finish_photo_review((j->>'token')::uuid,true,.99,'Objeto correcto.',false);
 if result->>'status'<>'approved' or(result->>'points')::integer<>17 then raise exception 'AI approval did not score';end if;
 select points into before_points from public.participants where id=auth.uid();
 perform public.finish_photo_review((j->>'token')::uuid,true,.99,'Duplicate.',false);
 s:=public.save_photo_submission(c,auth.uid()::text||'/'||gen_random_uuid()||'.jpg');
 select points into after_points from public.participants where id=auth.uid();
 if before_points<>after_points or s->>'status'<>'approved' then raise exception 'Completed challenge was reset or scored twice';end if;
 insert into public.challenges(description,points,active) values('Transaction-only rejected photo challenge',11,true) returning id into c;
 s:=public.save_photo_submission(c,auth.uid()::text||'/'||gen_random_uuid()||'.jpg');j:=public.claim_photo_review((s->>'id')::uuid,auth.uid());
 result:=public.finish_photo_review((j->>'token')::uuid,true,.5,'No es claro.',false);
 if result->>'status'<>'rejected' or(result->>'points')::integer<>0 then raise exception 'Uncertain evidence scored';end if;
 s:=public.save_photo_submission(c,auth.uid()::text||'/'||gen_random_uuid()||'.jpg');
 if s->>'status'<>'pending' then raise exception 'Rejected photo cannot be retaken';end if;
 insert into public.challenges(description,points,active) values('Transaction-only error photo challenge',11,true) returning id into c;
 s:=public.save_photo_submission(c,auth.uid()::text||'/'||gen_random_uuid()||'.jpg');j:=public.claim_photo_review((s->>'id')::uuid,auth.uid());
 result:=public.finish_photo_review((j->>'token')::uuid,false,0,'Servicio temporalmente no disponible.',true);
 if result->>'status'<>'error' or(select status from public.submissions where id=(s->>'id')::uuid)<>'pending' then raise exception 'Infrastructure failure converted into acceptance';end if;
 if(select points from public.participants where id=auth.uid())<>before_points then raise exception 'Rejected/error photo changed score';end if;
 -- Infrastructure failures must not force the participant to retake the same photo.
 for i in 1..3 loop
  update pilots_private.photo_reviews set created_at=clock_timestamp()-interval '20 seconds' where submission_id=(s->>'id')::uuid;
  j:=public.claim_photo_review((s->>'id')::uuid,auth.uid());
  if not(j ? 'token') then raise exception 'Saved photo became permanently blocked after provider errors';end if;
  perform public.finish_photo_review((j->>'token')::uuid,false,0,'Provider failure.',true);
 end loop;
 begin perform public.save_photo_submission(c,'other-user/'||gen_random_uuid()||'.jpg');raise exception 'Foreign photo path accepted';exception when raise_exception then if sqlerrm not ilike '%Ruta%' then raise;end if;end;
end $$;
set local role authenticated;
do $$begin
 if has_function_privilege('authenticated','public.claim_photo_review(uuid,uuid)','EXECUTE') or has_function_privilege('authenticated','public.finish_photo_review(uuid,boolean,numeric,text,boolean)','EXECUTE') then raise exception 'Player can self-approve evidence';end if;
 if has_table_privilege('authenticated','pilots_private.photo_reviews','SELECT') then raise exception 'Private validation records exposed';end if;
end $$;
set local role service_role;
do $$begin
 if not has_function_privilege('service_role','public.claim_photo_review(uuid,uuid)','EXECUTE') then raise exception 'Backend cannot claim review';end if;
end $$;
set local role anon;
do $$begin
 if has_function_privilege('anon','public.save_photo_submission(uuid,text)','EXECUTE') or has_function_privilege('anon','public.finish_photo_review(uuid,boolean,numeric,text,boolean)','EXECUTE') then raise exception 'Unauthenticated photo scoring exposed';end if;
end $$;
reset role;
rollback;
