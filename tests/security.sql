-- Run against the existing project with an administrative SQL connection.
-- All fixtures and point changes are rolled back. Existing rows are not removed.
begin;
select set_config('pilots.test_participant', (select id::text from public.participants limit 1), true);
select set_config('pilots.test_admin', (select user_id::text from public.admins limit 1), true);
insert into public.questions(game,question,options,correct_answer,points,active)
values('trivia','Temporary transaction-only security test','["A","B","C","D"]','A',7,true)
returning set_config('pilots.test_question',id::text,true);

insert into public.challenges(description,points,active)
values('Temporary transaction-only evidence test',15,true)
returning set_config('pilots.test_challenge',id::text,true);

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.test_participant'),'role','authenticated','is_anonymous',true)::text,true);
do $$
declare result jsonb; before_points integer; after_points integer;
begin
  if public.is_admin() then raise exception 'Test participant must not be an admin'; end if;
  if has_table_privilege('authenticated','public.public_ranking','UPDATE') then raise exception 'Ranking is writable'; end if;
  if has_table_privilege('authenticated','public.public_questions','INSERT') then raise exception 'Question projection is writable'; end if;
  if exists(select 1 from public.questions) then raise exception 'Player can read correct answers'; end if;
  if exists(select 1 from public.admin_submissions) then raise exception 'Player can read admin evidence'; end if;
  select points into before_points from public.participants where id=auth.uid();
  result:=public.submit_answer(current_setting('pilots.test_question')::uuid,'A');
  if not (result->>'correct')::boolean or (result->>'points')::integer<>7 then raise exception 'Wrong scoring result'; end if;
  select points into after_points from public.participants where id=auth.uid();
  if after_points<>before_points+7 then raise exception 'Score increment failed'; end if;
  if not exists(select 1 from public.answer_attempts where question_id=current_setting('pilots.test_question')::uuid) then raise exception 'Own attempt is not readable'; end if;
  begin
    perform public.submit_answer(current_setting('pilots.test_question')::uuid,'A');
    raise exception 'Duplicate answer was accepted';
  exception when raise_exception then
    if sqlerrm not ilike '%Ya respondiste%' then raise; end if;
  end;
  begin
    perform public.review_submission(gen_random_uuid(),true);
    raise exception 'Player was allowed to review';
  exception when raise_exception then
    if sqlerrm not ilike '%No autorizado%' then raise; end if;
  end;
end $$;

insert into public.submissions(participant_id,challenge_id,photo_path)
values(auth.uid(),current_setting('pilots.test_challenge')::uuid,auth.uid()::text || '/transaction-only-test.png')
returning set_config('pilots.test_submission',id::text,true);

-- The existing organizer can see the transaction's question and read private views.
select set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.test_admin'),'role','authenticated','is_anonymous',false)::text,true);
do $$ begin
  if not public.is_admin() then raise exception 'Organizer cannot authorize'; end if;
  if not exists(select 1 from public.questions where id=current_setting('pilots.test_question')::uuid) then raise exception 'Organizer cannot manage questions'; end if;
  if not exists(select 1 from public.admin_submissions where id=current_setting('pilots.test_submission')::uuid) then raise exception 'Organizer cannot read pending evidence'; end if;
  perform public.review_submission(current_setting('pilots.test_submission')::uuid,true);
  if not exists(select 1 from public.submissions where id=current_setting('pilots.test_submission')::uuid and status='approved') then raise exception 'Approval did not persist'; end if;
  begin
    perform public.review_submission(current_setting('pilots.test_submission')::uuid,true);
    raise exception 'Duplicate approval was accepted';
  exception when raise_exception then
    if sqlerrm not ilike '%ya revisada%' then raise; end if;
  end;
end $$;

set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
  if has_table_privilege('anon','public.public_ranking','UPDATE') then raise exception 'Anon can update ranking'; end if;
  if has_table_privilege('anon','public.admin_submissions','SELECT') then raise exception 'Anon can read evidence view'; end if;
  if has_function_privilege('anon','public.submit_answer(uuid,text)','EXECUTE') then raise exception 'Anon can submit answers'; end if;
  if has_function_privilege('anon','public.register_participant(text,text)','EXECUTE') then raise exception 'Anon can register without session'; end if;
  perform count(*) from public.public_questions;
  perform count(*) from public.public_ranking;
  perform count(*) from public.challenges where active;
end $$;
reset role;
rollback;
