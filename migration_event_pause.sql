-- Event control: only the organizer can pause, resume or schedule a closing time.
-- Existing participants, attempts, evidence and points are preserved.
create table pilots_private.event_control (
 singleton boolean primary key default true check(singleton),
 paused boolean not null default false,
 paused_at timestamptz,
 closes_at timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
insert into pilots_private.event_control(singleton) values(true);
alter table pilots_private.event_control enable row level security;
revoke all on pilots_private.event_control from public,anon,authenticated,service_role;
alter table pilots_private.block_runs add column paused_seconds numeric not null default 0;

create function pilots_private.event_snapshot() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('paused',paused or (closes_at is not null and closes_at<=clock_timestamp()),
 'paused_at',case when paused then paused_at when closes_at<=clock_timestamp() then closes_at else null end,
 'closes_at',closes_at,'server_now',clock_timestamp()) from pilots_private.event_control where singleton
$$;
create function pilots_private.event_accepting() returns boolean language plpgsql security definer set search_path='' as $$
declare e pilots_private.event_control%rowtype;
begin
 select * into strict e from pilots_private.event_control where singleton for share;
 return not e.paused and (e.closes_at is null or e.closes_at>clock_timestamp());
end $$;
create function pilots_private.require_event_open() returns void language plpgsql security definer set search_path='' as $$
begin
 if not pilots_private.event_accepting() then raise exception 'EVENT_PAUSED: El juego está cerrado temporalmente. Tus puntos y tu progreso se conservan.';end if;
end $$;
create function pilots_private.event_clock() returns timestamptz language sql security definer set search_path='' as $$
 select case when paused then paused_at when closes_at<=clock_timestamp() then closes_at else clock_timestamp() end from pilots_private.event_control where singleton
$$;
create function pilots_private.control_event(p_action text,p_closes_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare e pilots_private.event_control%rowtype;anchor timestamptz;t timestamptz;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'No autorizado';end if;
 select * into strict e from pilots_private.event_control where singleton for update;
 t:=clock_timestamp();anchor:=case when e.paused then e.paused_at when e.closes_at<=t then e.closes_at else null end;
 if p_action='pause' then
  update pilots_private.event_control set paused=true,paused_at=coalesce(anchor,t),updated_at=t where singleton;
 elsif p_action='resume' then
  if anchor is not null then
   update pilots_private.block_runs set paused_seconds=paused_seconds+greatest(0,extract(epoch from(t-greatest(anchor,started_at)))) where finished_at is null and started_at<t;
  end if;
  update pilots_private.event_control set paused=false,paused_at=null,closes_at=null,updated_at=t where singleton;
 elsif p_action='schedule' then
  if anchor is not null then raise exception 'Reanuda el juego antes de programar otro cierre';end if;
  if p_closes_at is not null and p_closes_at<=t then raise exception 'Elige una hora futura';end if;
  update pilots_private.event_control set closes_at=p_closes_at,updated_at=t where singleton;
 else raise exception 'Acción inválida';end if;
 return pilots_private.event_snapshot();
end $$;
create function public.get_event_state() returns jsonb language sql security invoker set search_path='' as $$select pilots_private.event_snapshot()$$;
create function public.control_event(p_action text,p_closes_at timestamptz default null) returns jsonb language sql security invoker set search_path='' as $$select pilots_private.control_event(p_action,p_closes_at)$$;
revoke all on function pilots_private.event_snapshot(),pilots_private.event_accepting(),pilots_private.require_event_open(),pilots_private.event_clock(),pilots_private.control_event(text,timestamptz),public.get_event_state(),public.control_event(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function pilots_private.event_snapshot(),public.get_event_state() to authenticated;
grant execute on function pilots_private.control_event(text,timestamptz),public.control_event(text,timestamptz) to authenticated;

-- Guard the existing implementations before any participant or evidence locks.
-- Shared event-row locks make an organizer pause wait for earlier scoring commits.
do $$
declare sig text;def text;patched text;
begin
 foreach sig in array array['pilots_private.start_block(text,integer)','pilots_private.submit_block_answer(uuid,text)','pilots_private.save_photo_submission(uuid,text)','pilots_private.claim_photo_review(uuid,uuid)','pilots_private.organizer_review(uuid,boolean)'] loop
  def:=pg_get_functiondef(sig::regprocedure);
  patched:=regexp_replace(def,E'\nbegin\n',E'\nbegin\n perform pilots_private.require_event_open();\n');
  if patched=def then raise exception 'Cannot guard %',sig;end if;
  execute patched;
 end loop;
 def:=pg_get_functiondef('pilots_private.finish_photo_review(uuid,boolean,numeric,text,boolean)'::regprocedure);
 patched:=regexp_replace(def,E'\nbegin\n',E'\nbegin\n if not pilots_private.event_accepting() then\n  update pilots_private.photo_reviews set status=''error'',completed_at=clock_timestamp(),reason=''Juego pausado: vuelve a validar al reanudar.'' where token=p_token and status=''processing'';\n  return jsonb_build_object(''status'',''paused'',''points'',0,''reason'',''El juego está pausado. Tu foto se conserva; podrás validarla al reanudar.'');\n end if;\n');
 if patched=def then raise exception 'Cannot guard AI completion';end if;execute patched;
 foreach sig in array array['pilots_private.block_state(text,integer)','pilots_private.submit_block_answer(uuid,text)'] loop
  def:=pg_get_functiondef(sig::regprocedure);
  patched:=replace(def,'coalesce(r.finished_at,clock_timestamp())-r.started_at','coalesce(r.finished_at,pilots_private.event_clock())-r.started_at');
  patched:=replace(patched,'clock_timestamp()-r.started_at','pilots_private.event_clock()-r.started_at');
  patched:=replace(patched,'-r.started_at)))','-r.started_at))-r.paused_seconds)');
  if patched=def then raise exception 'Cannot freeze clock %',sig;end if;execute patched;
 end loop;
end $$;

-- Defense in depth for current and older clients and exact scheduled cutoffs.
create function pilots_private.guard_event_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pilots_private.require_event_open();return new;
end $$;
revoke all on function pilots_private.guard_event_write() from public,anon,authenticated,service_role;
create trigger event_guard_points before update of points on public.participants for each row execute function pilots_private.guard_event_write();
create trigger event_guard_attempt before insert on public.answer_attempts for each row execute function pilots_private.guard_event_write();
create trigger event_guard_submission before insert or update on public.submissions for each row execute function pilots_private.guard_event_write();
