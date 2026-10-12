create or replace function public.simphony_bridge_auth(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from private.app_settings
    where key='simphony_bridge_token' and value=p_token
  );
$$;
revoke execute on function public.simphony_bridge_auth(text) from public, anon, authenticated;
grant execute on function public.simphony_bridge_auth(text) to service_role;
