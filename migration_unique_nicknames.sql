-- Case-insensitive, whitespace-normalized uniqueness is enforced atomically.
create unique index participants_nickname_unique on public.participants
 ((lower(btrim(regexp_replace(nickname,'[[:space:]]+',' ','g')))));
create or replace function public.register_participant(p_nickname text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare clean_name text;violated_constraint text;
begin
 if auth.uid() is null then raise exception 'Inicia sesión primero';end if;
 clean_name:=btrim(regexp_replace(p_nickname,'[[:space:]]+',' ','g'));
 if p_role is null or p_role not in ('FO','CT') or clean_name is null or char_length(clean_name) not between 2 and 24 then raise exception 'Datos de participante inválidos';end if;
 begin
  insert into public.participants(id,nickname,role) values(auth.uid(),clean_name,p_role);
 exception when unique_violation then
  get stacked diagnostics violated_constraint=constraint_name;
  if violated_constraint='participants_nickname_unique' then
   raise exception using errcode='23505',message='NICKNAME_TAKEN: Ese pseudónimo ya está ocupado. Elige otro.';
  end if;
  raise;
 end;
end $$;
-- Retain the existing signed-in registration boundary.
revoke execute on function public.register_participant(text,text) from public,anon;
grant execute on function public.register_participant(text,text) to authenticated;
