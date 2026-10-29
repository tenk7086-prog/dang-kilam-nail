begin;
create or replace function public.admin_set_closed_days(
 p_from date, p_to date, p_notice text default '', p_remove boolean default false
) returns void language plpgsql security definer set search_path='' as $$
declare today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 perform nail_private.require_owner();
 if p_from is null or p_to is null or p_remove is null or p_from<today
    or p_to<p_from or p_to-p_from>365 or length(coalesce(p_notice,''))>500 then
   raise exception 'invalid_request';
 end if;
 perform pg_advisory_xact_lock(181001);
 if not p_remove and exists (
   select 1 from nail_private.bookings where status='confirmed'
   and starts_at >= p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'
   and starts_at < (p_to+1)::timestamp at time zone 'Asia/Ho_Chi_Minh'
 ) then raise exception 'closed_day_has_bookings'; end if;
 if p_remove then
   delete from public.closed_days where local_date between p_from and p_to;
 else
   insert into public.closed_days(local_date,notice)
   select p_from+i,coalesce(p_notice,'') from generate_series(0,p_to-p_from) i
   on conflict(local_date) do update set notice=excluded.notice;
 end if;
 perform nail_private.refresh_slots();
end $$;
revoke all on function public.admin_set_closed_days(date,date,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_closed_days(date,date,text,boolean) to authenticated;
commit;
