-- Transaction-only users: nothing from this test is committed.
begin;
select set_config('pilots.unique_first',gen_random_uuid()::text,true),set_config('pilots.unique_second',gen_random_uuid()::text,true),set_config('pilots.unique_name','Q'||substr(replace(gen_random_uuid()::text,'-',''),1,10)||' Pilot',true);
insert into auth.users(id,email) values(current_setting('pilots.unique_first')::uuid,'unique-first@example.invalid'),(current_setting('pilots.unique_second')::uuid,'unique-second@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.unique_first'),'role','authenticated')::text,true);
select public.register_participant('  '||current_setting('pilots.unique_name')||'  ','FO');
select set_config('request.jwt.claims',json_build_object('sub',current_setting('pilots.unique_second'),'role','authenticated')::text,true);
do $$declare duplicate text;message text;attempts integer:=0;
begin
 foreach duplicate in array array[lower(current_setting('pilots.unique_name')),upper(current_setting('pilots.unique_name')),'  '||current_setting('pilots.unique_name')||'  ',replace(current_setting('pilots.unique_name'),' ','   '),E'\t'||current_setting('pilots.unique_name')||E'\n'] loop
  begin
   perform public.register_participant(duplicate,'CT');raise exception 'Duplicate nickname was accepted';
  exception when unique_violation then
   get stacked diagnostics message=message_text;
   if message not like 'NICKNAME_TAKEN:%' then raise exception 'Missing friendly conflict: %',message;end if;
   attempts:=attempts+1;
  end;
 end loop;
 if attempts<>5 then raise exception 'Nickname variants not checked';end if;
 if exists(select 1 from public.participants where id=auth.uid()) then raise exception 'Rejected name created a participant';end if;
 perform public.register_participant(current_setting('pilots.unique_name')||' 2','CT');
 if not exists(select 1 from public.participants where id=auth.uid() and points=0 and role='CT') then raise exception 'Same session cannot choose another name';end if;
 if has_function_privilege('anon','public.register_participant(text,text)','EXECUTE') then raise exception 'Anonymous registration boundary changed';end if;
end $$;
rollback;
