-- Targeted update of the existing installation. No tables, users or rows are removed.
-- Public projections must be read-only: updatable owner views otherwise bypass RLS.
revoke all privileges on public.public_questions, public.public_ranking, public.admin_submissions from public, anon, authenticated;
grant select on public.public_questions, public.public_ranking to anon, authenticated;
grant select on public.admin_submissions to authenticated;
alter view public.admin_submissions set (security_invoker = true, security_barrier = true);

-- Scoring and registration require an authenticated session. is_admin remains callable
-- by anon because the existing public challenge read policy invokes it; it returns false.
revoke execute on function public.register_participant(text,text), public.submit_answer(uuid,text), public.review_submission(uuid,boolean) from public, anon;
grant execute on function public.register_participant(text,text), public.submit_answer(uuid,text), public.review_submission(uuid,boolean) to authenticated;

-- A player can read their own attempts to resume without attempting answered questions.
alter policy "admin read attempts" on public.answer_attempts
  using (participant_id = (select auth.uid()) or (select public.is_admin()));

create index if not exists answer_attempts_question_id_idx on public.answer_attempts(question_id);
create index if not exists submissions_challenge_id_idx on public.submissions(challenge_id);

-- Applied after the web is deployed with RPC registration.
revoke insert,update,delete,truncate,references,trigger on public.participants from public,anon,authenticated;
drop policy if exists participants_insert_own on public.participants;
drop policy if exists participants_select_own on public.participants;
