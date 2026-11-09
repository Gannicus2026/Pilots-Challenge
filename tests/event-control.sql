-- Transaction-only fixtures: the real event and all existing scores are restored.
begin;
select set_config('pilots.test_admin',(select user_id::text from public.admins limit 1),true);
insert into auth.users(id,email) values(gen_random_uuid(),'event-control-test@example.invalid') returning set_config('pilots.event_player',id::text,true);
insert into public.participants(id,nickname,role) values(current_setting('pilots.event_player')::uuid,'Event control test','FO');
insert into public.questions(game,level,question,options,correct_answer,points,active) values('trivia',1,'Transaction-only pause test','["A","B","C","D"]','A',10,true) returning set_config('pilots.event_question',id::text,true);
insert into public.challenges(description,points,active) values('Transaction-only pause photo',17,true) returning set_config('pilots.event_challenge',id::text,true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.event_player'),'role','authenticated')::text,true);
do $$declare s jsonb;j jsonb;v jsonb;elapsed_before numeric;elapsed_after numeric;pts integer;
begin
 perform public.start_block('trivia',1);
 update pilots_private.block_runs set questions=(select jsonb_agg(to_jsonb(q)) from public.questions q where id=current_setting('pilots.event_question')::uuid),question_ids=array[current_setting('pilots.event_question')::uuid],started_at=clock_timestamp()-interval '300 seconds' where participant_id=auth.uid();
 s:=public.save_photo_submission(current_setting('pilots.event_challenge')::uuid,auth.uid()::text||'/'||gen_random_uuid()||'.jpg');
 j:=public.claim_photo_review((s->>'id')::uuid,auth.uid());perform set_config('pilots.event_token',j->>'token',true);perform set_config('pilots.event_submission',s->>'id',true);
 begin perform public.control_event('pause');raise exception 'Non-admin paused event';exception when raise_exception then if sqlerrm<>'No autorizado' then raise;end if;end;
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.test_admin'),'role','authenticated')::text,true);
 perform public.control_event('pause');
 -- Simulate two minutes of closed time without waiting or changing real clocks.
 update pilots_private.event_control set paused_at=clock_timestamp()-interval '120 seconds';
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.event_player'),'role','authenticated')::text,true);
 if not (public.get_event_state()->>'paused')::boolean then raise exception 'Pause not visible';end if;
 elapsed_before:=(pilots_private.block_state('trivia',1)->>'elapsed_seconds')::numeric;
 begin perform public.submit_answer(current_setting('pilots.event_question')::uuid,'A');raise exception 'Answer accepted during pause';exception when raise_exception then if sqlerrm not like 'EVENT_PAUSED:%' then raise;end if;end;
 begin perform public.save_photo_submission(current_setting('pilots.event_challenge')::uuid,auth.uid()::text||'/'||gen_random_uuid()||'.jpg');raise exception 'Photo accepted during pause';exception when raise_exception then if sqlerrm not like 'EVENT_PAUSED:%' then raise;end if;end;
 begin update public.participants set points=points+100 where id=auth.uid();raise exception 'Score changed during pause';exception when raise_exception then if sqlerrm not like 'EVENT_PAUSED:%' then raise;end if;end;
 v:=public.finish_photo_review(current_setting('pilots.event_token')::uuid,true,.99,'Test',false);
 if v->>'status'<>'paused' or(v->>'points')::int<>0 then raise exception 'In-flight AI scored during pause';end if;
 if (select status from public.submissions where id=current_setting('pilots.event_submission')::uuid)<>'pending' then raise exception 'Saved photo lost';end if;
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.test_admin'),'role','authenticated')::text,true);
 perform public.control_event('resume');perform public.control_event('resume');
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.event_player'),'role','authenticated')::text,true);
 elapsed_after:=(pilots_private.block_state('trivia',1)->>'elapsed_seconds')::numeric;
 if abs(elapsed_after-elapsed_before)>2 then raise exception 'Pause consumed bonus time';end if;
 -- Scheduled close blocks writes even without a browser polling or a cron job.
 update pilots_private.event_control set closes_at=clock_timestamp()-interval '60 seconds';
 if not(public.get_event_state()->>'paused')::boolean then raise exception 'Deadline failed';end if;
 begin perform public.submit_answer(current_setting('pilots.event_question')::uuid,'A');raise exception 'Answer accepted after deadline';exception when raise_exception then if sqlerrm not like 'EVENT_PAUSED:%' then raise;end if;end;
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.test_admin'),'role','authenticated')::text,true);perform public.control_event('resume');
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.event_player'),'role','authenticated')::text,true);
 v:=public.submit_answer(current_setting('pilots.event_question')::uuid,'A');
 if not(v->'block'->>'finished')::boolean or (v->'block'->>'bonus_points')::int<>5 then raise exception 'Resumed block/bonus incorrect: %',v;end if;
 select points into pts from public.participants where id=auth.uid();if pts<>15 then raise exception 'Score not preserved on resume';end if;
 update pilots_private.photo_reviews set created_at=clock_timestamp()-interval '30 seconds' where token=current_setting('pilots.event_token')::uuid;
 j:=public.claim_photo_review(current_setting('pilots.event_submission')::uuid,auth.uid());
 v:=public.finish_photo_review((j->>'token')::uuid,true,.99,'Test',false);
 if v->>'status'<>'approved' then raise exception 'Saved photo cannot resume';end if;
 select points into pts from public.participants where id=auth.uid();if pts<>32 then raise exception 'Resumed photo score incorrect';end if;
 if has_table_privilege('authenticated','pilots_private.event_control','UPDATE') then raise exception 'Player can directly edit event';end if;
 if has_function_privilege('anon','public.control_event(text,timestamptz)','EXECUTE') then raise exception 'Unauthenticated control exposed';end if;
end $$;
set local role authenticated;
select public.get_event_state();
do $$begin
 begin perform public.control_event('pause');raise exception 'Player role paused event';exception when raise_exception then if sqlerrm<>'No autorizado' then raise;end if;end;
 if has_function_privilege('authenticated','pilots_private.require_event_open()','EXECUTE') then raise exception 'Private write helper exposed';end if;
end $$;
rollback;
