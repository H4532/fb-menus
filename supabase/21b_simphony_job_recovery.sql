-- Recover bridge jobs abandoned by a crashed/restarted onsite agent.
create or replace function public.claim_simphony_job(p_outlet_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet_id uuid;
  v_job public.simphony_jobs%rowtype;
begin
  select id into v_outlet_id from public.outlets where slug=p_outlet_slug;
  if v_outlet_id is null then return null; end if;

  update public.simphony_jobs
     set status='failed', completed_at=now(), error_message='Bridge stopped while processing after 3 attempts.'
   where outlet_id=v_outlet_id and status='processing'
     and started_at < now()-interval '10 minutes' and attempts >= 3;

  update public.simphony_jobs
     set status='queued', started_at=null, error_message='Recovered after bridge interruption.'
   where outlet_id=v_outlet_id and status='processing'
     and started_at < now()-interval '10 minutes' and attempts < 3;

  select j.* into v_job
  from public.simphony_jobs j
  where j.outlet_id=v_outlet_id and j.status='queued'
  order by j.requested_at
  for update skip locked
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
            'name',oi.name,'qty',oi.qty,'note',oi.note,
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
