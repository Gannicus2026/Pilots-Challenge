-- ARCHIVO HISTÓRICO: NO EJECUTAR SOBRE EL PROYECTO EXISTENTE.
-- La instalación actual y sus ajustes se mantienen mediante las migraciones de Supabase.
-- Consulta README.md y migration_event_configuration.sql.

-- PILOTS CHALLENGE — esquema inicial para Supabase
-- Ejecutar completo en Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.participants(
 id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null check (char_length(nickname) between 2 and 24),
 role text not null check (role in ('FO','CT')),
 points integer not null default 0 check(points>=0),
 created_at timestamptz not null default now()
);
create table if not exists public.admins(user_id uuid primary key references auth.users(id) on delete cascade);
create table if not exists public.questions(
 id uuid primary key default gen_random_uuid(),
 game text not null check(game in ('trivia','tf')),
 level integer not null default 1 check(level between 1 and 3),
 question text not null,
 options jsonb not null,
 correct_answer text not null,
 points integer not null default 10 check(points>0),
 created_at timestamptz not null default now()
);
create table if not exists public.answer_attempts(
 id uuid primary key default gen_random_uuid(),
 participant_id uuid not null references participants(id) on delete cascade,
 question_id uuid not null references questions(id) on delete cascade,
 answer text not null,
 correct boolean not null,
 points_awarded integer not null default 0,
 created_at timestamptz not null default now(),
 unique(participant_id,question_id)
);
create table if not exists public.challenges(
 id uuid primary key default gen_random_uuid(),
 description text not null,
 points integer not null default 15 check(points>0),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.submissions(
 id uuid primary key default gen_random_uuid(),
 participant_id uuid not null references participants(id) on delete cascade,
 challenge_id uuid not null references challenges(id) on delete cascade,
 photo_path text not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 unique(participant_id,challenge_id)
);

alter table participants enable row level security;
alter table admins enable row level security;
alter table questions enable row level security;
alter table answer_attempts enable row level security;
alter table challenges enable row level security;
alter table submissions enable row level security;

-- Helpers: administración y pertenencia.
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.admins where user_id=auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- Participantes: cada uno crea/lee su ficha; ranking público usa una vista limitada.
create policy "participant insert own" on participants for insert to authenticated with check(id=auth.uid());
create policy "participant read own" on participants for select to authenticated using(id=auth.uid() or is_admin());
create policy "admin update participants" on participants for update to authenticated using(is_admin()) with check(is_admin());

-- Administradores pueden gestionar preguntas; jugadores solo leen vista pública sin respuestas correctas.
create policy "admin manage questions" on questions for all to authenticated using(is_admin()) with check(is_admin());
create or replace view public.public_questions as
 select id,game,level,question,options,points,created_at from public.questions;
grant select on public.public_questions to anon,authenticated;
grant select,insert,update,delete on public.questions to authenticated;
revoke select on public.questions from anon,authenticated;
grant select on public.questions to authenticated; -- RLS deja estas filas visibles solo a administradores

create policy "admin read answers" on answer_attempts for select to authenticated using(is_admin());
create policy "admin read challenges" on challenges for select to authenticated using(is_admin());
create policy "public read active challenges" on challenges for select to anon,authenticated using(active=true);
create policy "admin manage challenges" on challenges for all to authenticated using(is_admin()) with check(is_admin());

create policy "participant insert submission" on submissions for insert to authenticated with check(participant_id=auth.uid());
create policy "participant read own submissions" on submissions for select to authenticated using(participant_id=auth.uid() or is_admin());
create policy "admin update submissions" on submissions for update to authenticated using(is_admin()) with check(is_admin());

create or replace view public.public_ranking as
 select nickname,role,points from public.participants;
grant select on public.public_ranking to anon,authenticated;

-- El participante no puede elegir su puntaje: la función compara la respuesta en el servidor.
create or replace function public.submit_answer(p_question_id uuid,p_answer text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare q questions%rowtype; already boolean; is_right boolean; awarded integer;
begin
 if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
 select * into q from questions where id=p_question_id;
 if not found then raise exception 'Pregunta no encontrada.'; end if;
 select exists(select 1 from answer_attempts where participant_id=auth.uid() and question_id=p_question_id) into already;
 if already then raise exception 'Ya respondiste esta pregunta.'; end if;
 is_right := upper(p_answer)=upper(q.correct_answer);
 awarded := case when is_right then q.points else 0 end;
 insert into answer_attempts(participant_id,question_id,answer,correct,points_awarded)
 values(auth.uid(),p_question_id,p_answer,is_right,awarded);
 if awarded>0 then update participants set points=points+awarded where id=auth.uid(); end if;
 return jsonb_build_object('correct',is_right,'points',awarded);
end; $$;
grant execute on function public.submit_answer(uuid,text) to authenticated;

create or replace function public.review_submission(p_submission_id uuid,p_approved boolean)
returns void language plpgsql security definer set search_path=public as $$
declare s submissions%rowtype; pts integer;
begin
 if not is_admin() then raise exception 'No autorizado.'; end if;
 select * into s from submissions where id=p_submission_id for update;
 if not found or s.status<>'pending' then raise exception 'Evidencia no disponible o ya revisada.'; end if;
 update submissions set status=case when p_approved then 'approved' else 'rejected' end,reviewed_at=now() where id=p_submission_id;
 if p_approved then select points into pts from challenges where id=s.challenge_id; update participants set points=points+pts where id=s.participant_id; end if;
end; $$;
grant execute on function public.review_submission(uuid,boolean) to authenticated;

-- Storage privado: las fotos no quedan expuestas públicamente.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('evidence','evidence',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy "participant upload own evidence" on storage.objects for insert to authenticated
with check(bucket_id='evidence' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "admin read evidence" on storage.objects for select to authenticated
using(bucket_id='evidence' and public.is_admin());
-- Vista de evidencias para panel. URL firmada se genera desde el cliente tras consultar el registro.
create or replace view public.admin_submissions as
 select s.id,s.status,s.photo_path,s.created_at,p.nickname,p.role,c.description,c.points
 from submissions s join participants p on p.id=s.participant_id join challenges c on c.id=s.challenge_id
 where public.is_admin();
grant select on public.admin_submissions to authenticated;
