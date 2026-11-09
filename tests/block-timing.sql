-- Transaction-only fixtures: no existing accounts, answers or scores are changed.
begin;
insert into auth.users(id,email) values(gen_random_uuid(),'transaction-only-timing@example.invalid') returning set_config('pilots.timing_user',id::text,true);
insert into public.participants(id,nickname,role) values(current_setting('pilots.timing_user')::uuid,'Timing test','FO');
select set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.timing_user'),'role','authenticated','is_anonymous',true)::text,true);
do $$
declare state jsonb; resumed jsonb; response jsonb; item jsonb; g text; lv integer; n integer; before_score integer; after_score integer; first_score integer; expected integer; started text;
begin
 for n in 1..4 loop
  g:=case when n=4 then 'tf' else 'trivia' end;lv:=case when n=4 then 1 else n end;
  select points into before_score from public.participants where id=auth.uid();
  state:=public.start_block(g,lv);started:=state->>'started_at';
  if state->'questions'->0 ? 'correct_answer' then raise exception 'Correct answer leaked'; end if;
  resumed:=public.start_block(g,lv);
  if resumed->>'started_at'<>started then raise exception 'Clock reset on resume'; end if;
  if n=2 then update pilots_private.block_runs set started_at=clock_timestamp()-interval '104 seconds' where participant_id=auth.uid() and game=g and level=lv; end if;
  if n=3 then update pilots_private.block_runs set started_at=clock_timestamp()-interval '181 seconds' where participant_id=auth.uid() and game=g and level=lv; end if;
  -- Changing publication during a run must not change its captured question set.
  if n=1 then update public.questions set active=false where id=(state->'questions'->0->>'id')::uuid; end if;
  first_score:=null;
  for item in select value from jsonb_array_elements((select questions from pilots_private.block_runs where participant_id=auth.uid() and game=g and level=lv)) loop
   response:=public.submit_answer((item->>'id')::uuid,case when n=4 then case when item->>'correct_answer'='V' then 'F' else 'V' end else item->>'correct_answer' end);
   if first_score is null then
    select points into first_score from public.participants where id=auth.uid();
    if (response->'block'->>'finished')::boolean or first_score<>before_score+(response->>'points')::integer then raise exception 'Early or per-question bonus'; end if;
   end if;
  end loop;
  state:=response->'block';
  if not(state->>'finished')::boolean then raise exception 'Block did not finish'; end if;
  expected:=case when n=1 then 50 when n=2 then 25 else 0 end;
  if(state->>'bonus_points')::integer<>expected then raise exception 'Wrong bonus for scenario %: %',n,state; end if;
  select points into after_score from public.participants where id=auth.uid();
  if after_score<>before_score+(state->>'base_points')::integer+expected then raise exception 'Wrong total increment'; end if;
  resumed:=public.start_block(g,lv);
  if resumed->>'bonus_points'<>state->>'bonus_points' then raise exception 'Resume changed final bonus'; end if;
  begin
   perform public.submit_answer((item->>'id')::uuid,item->>'correct_answer');
   raise exception 'Duplicate answer accepted';
  exception when raise_exception then if sqlerrm not ilike '%Ya respondiste%' then raise; end if; end;
  if(select points from public.participants where id=auth.uid())<>after_score then raise exception 'Duplicate bonus paid'; end if;
 end loop;
end $$;
set local role authenticated;
do $$ begin
 if has_table_privilege('authenticated','pilots_private.block_runs','UPDATE') or has_table_privilege('authenticated','pilots_private.block_runs','SELECT') then raise exception 'Player can tamper with or read private timer snapshots'; end if;
 if has_function_privilege('authenticated','pilots_private.block_state(text,integer)','EXECUTE') then raise exception 'Private state helper exposed'; end if;
 perform public.start_block('trivia',1);
 begin perform public.start_block('objects',1);raise exception 'Invalid block accepted'; exception when raise_exception then if sqlerrm not ilike '%inválido%' then raise; end if;end;
end $$;
set local role anon;
do $$ begin
 if has_function_privilege('anon','public.start_block(text,integer)','EXECUTE') then raise exception 'Unauthenticated timer allowed';end if;
end $$;
reset role;
rollback;
