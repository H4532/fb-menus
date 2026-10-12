-- =====================================================================
-- FB Menus — 21_simphony_order_queue.sql
-- Queue accepted web orders for the onsite Simphony bridge.
-- =====================================================================

create table if not exists public.simphony_jobs (
  id                  uuid primary key default gen_random_uuid(),
  outlet_id           uuid not null references public.outlets(id) on delete cascade,
  order_id            uuid not null references public.orders(id) on delete cascade,
  rvc_number          integer not null default 101 check (rvc_number > 0),
  order_type          integer not null default 2 check (order_type > 0),
  table_number        integer not null check (table_number > 0),
  status              text not null default 'queued'
                        check (status in ('queued','processing','sent','failed')),
  attempts            integer not null default 0 check (attempts >= 0),
  requested_by        uuid references auth.users(id) on delete set null,
  requested_at        timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  error_message       text,
  simphony_check_num  integer,
  simphony_check_seq  integer,
  simphony_response   jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint simphony_jobs_order_unique unique(order_id)
);

create index if not exists simphony_jobs_outlet_status_idx
  on public.simphony_jobs(outlet_id,status,requested_at);
create index if not exists simphony_jobs_order_idx
  on public.simphony_jobs(order_id);

drop trigger if exists simphony_jobs_set_updated_at on public.simphony_jobs;
create trigger simphony_jobs_set_updated_at before update on public.simphony_jobs
  for each row execute function public.set_updated_at();

revoke all on public.simphony_jobs from anon, authenticated;
grant select on public.simphony_jobs to authenticated;

alter table public.simphony_jobs enable row level security;
drop policy if exists simphony_jobs_admin_read on public.simphony_jobs;
create policy simphony_jobs_admin_read on public.simphony_jobs
  for select to authenticated
  using (private.has_perm(outlet_id,'orders'));

create or replace function public.queue_simphony_order(p_order_id uuid)
returns public.simphony_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_job public.simphony_jobs%rowtype;
  v_table integer;
  v_rvc integer;
begin
  select * into v_order from public.orders where id=p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if not private.has_perm(v_order.outlet_id,'orders') then raise exception 'PERMISSION_DENIED'; end if;
  if v_order.status not in ('accepted','ready') then raise exception 'ORDER_NOT_ACCEPTED'; end if;
  if v_order.location_type <> 'table' then raise exception 'SIMPHONY_TABLE_ONLY'; end if;

  begin
    v_table := v_order.location::integer;
  exception when others then
    raise exception 'INVALID_TABLE_NUMBER';
  end;
  if v_table <= 0 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  if exists (
    select 1 from public.order_items oi
    where oi.order_id=v_order.id
      and (oi.item_id is null or jsonb_array_length(coalesce(oi.options,'[]'::jsonb)) > 0)
  ) then
    raise exception 'SIMPHONY_OPTIONS_UNMAPPED';
  end if;

  if exists (
    select 1
    from public.order_items oi
    left join public.simphony_item_mappings m
      on m.item_id=oi.item_id and m.outlet_id=oi.outlet_id
    left join public.simphony_catalog_items c
      on c.id=m.catalog_item_id and c.outlet_id=oi.outlet_id and c.is_active
    where oi.order_id=v_order.id and c.id is null
  ) then
    raise exception 'SIMPHONY_ITEM_UNMAPPED';
  end if;

  select min(c.rvc_number) into v_rvc
  from public.order_items oi
  join public.simphony_item_mappings m on m.item_id=oi.item_id and m.outlet_id=oi.outlet_id
  join public.simphony_catalog_items c on c.id=m.catalog_item_id and c.outlet_id=oi.outlet_id
  where oi.order_id=v_order.id;

  if exists (
    select 1
    from public.order_items oi
    join public.simphony_item_mappings m on m.item_id=oi.item_id and m.outlet_id=oi.outlet_id
    join public.simphony_catalog_items c on c.id=m.catalog_item_id and c.outlet_id=oi.outlet_id
    where oi.order_id=v_order.id and c.rvc_number <> v_rvc
  ) then
    raise exception 'SIMPHONY_MIXED_RVC';
  end if;

  insert into public.simphony_jobs(outlet_id,order_id,rvc_number,order_type,table_number,status,attempts,requested_by,requested_at,error_message,started_at,completed_at,simphony_check_num,simphony_check_seq,simphony_response)
  values(v_order.outlet_id,v_order.id,v_rvc,2,v_table,'queued',0,auth.uid(),now(),null,null,null,null,null,null)
  on conflict(order_id) do update set
    rvc_number=excluded.rvc_number,
    order_type=2,
    table_number=excluded.table_number,
    status='queued',
    requested_by=auth.uid(),
    requested_at=now(),
    error_message=null,
    started_at=null,
    completed_at=null,
    simphony_check_num=null,
    simphony_check_seq=null,
    simphony_response=null
  returning * into v_job;

  return v_job;
end;
$$;

revoke execute on function public.queue_simphony_order(uuid) from public, anon;
grant execute on function public.queue_simphony_order(uuid) to authenticated;

create or replace function public.claim_simphony_job(p_outlet_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.simphony_jobs%rowtype;
begin
  select j.* into v_job
  from public.simphony_jobs j
  join public.outlets o on o.id=j.outlet_id
  where o.slug=p_outlet_slug and j.status='queued'
  order by j.requested_at
  for update of j skip locked
  limit 1;

  if not found then return null; end if;

  update public.simphony_jobs
  set status='processing', attempts=attempts+1, started_at=now(), error_message=null
  where id=v_job.id
  returning * into v_job;

  return jsonb_build_object(
    'job_id',v_job.id,
    'order_id',v_job.order_id,
    'rvc_number',v_job.rvc_number,
    'order_type',v_job.order_type,
    'table_number',v_job.table_number,
    'order',(
      select jsonb_build_object(
        'order_no',o.order_no,'guest_name',o.guest_name,'guest_note',o.guest_note,
        'items',coalesce((
          select jsonb_agg(jsonb_build_object(
            'name',oi.name,
            'qty',oi.qty,
            'note',oi.note,
            'object_number',c.object_number,
            'definition_sequence',c.definition_sequence,
            'price_sequence',c.price_sequence,
            'micros_name',c.name
          ) order by oi.created_at,oi.id)
          from public.order_items oi
          join public.simphony_item_mappings m on m.item_id=oi.item_id and m.outlet_id=oi.outlet_id
          join public.simphony_catalog_items c on c.id=m.catalog_item_id and c.outlet_id=oi.outlet_id
          where oi.order_id=o.id
        ),'[]'::jsonb)
      )
      from public.orders o where o.id=v_job.order_id
    )
  );
end;
$$;

revoke execute on function public.claim_simphony_job(text) from public, anon, authenticated;
grant execute on function public.claim_simphony_job(text) to service_role;
