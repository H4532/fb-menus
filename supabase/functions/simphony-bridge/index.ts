import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "content-type": "application/json",
};

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: cors });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const token = req.headers.get("x-bridge-token") || "";
    const { data: secretRow, error: secretErr } = await sb.schema("private").from("app_settings")
      .select("value").eq("key", "simphony_bridge_token").maybeSingle();
    if (secretErr) throw secretErr;
    if (!secretRow?.value || token !== secretRow.value) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "claim") {
      const slug = String(body.outlet_slug || "");
      if (!slug) return new Response(JSON.stringify({ error: "outlet_slug_required" }), { status: 400, headers: cors });
      const { data, error } = await sb.rpc("claim_simphony_job", { p_outlet_slug: slug });
      if (error) throw error;
      return new Response(JSON.stringify({ job: data || null }), { status: 200, headers: cors });
    }

    if (action === "result") {
      const jobId = String(body.job_id || "");
      if (!jobId) return new Response(JSON.stringify({ error: "job_id_required" }), { status: 400, headers: cors });

      const ok = body.success === true;
      const patch: Record<string, unknown> = {
        status: ok ? "sent" : "failed",
        completed_at: new Date().toISOString(),
        error_message: ok ? null : String(body.error || "Unknown Simphony bridge error").slice(0, 2000),
        simphony_response: body.response ?? null,
      };
      if (ok) {
        patch.simphony_check_num = body.check_num == null ? null : Number(body.check_num);
        patch.simphony_check_seq = body.check_seq == null ? null : Number(body.check_seq);
      }

      const { error } = await sb.from("simphony_jobs").update(patch).eq("id", jobId);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: cors });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: cors });
  }
});
