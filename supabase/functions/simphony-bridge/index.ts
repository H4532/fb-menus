import { createClient } from "npm:@supabase/supabase-js@2";

const headers = { "content-type": "application/json" };

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const token = req.headers.get("x-bridge-token") || "";
    const { data: authOk, error: authErr } = await sb.rpc("simphony_bridge_auth", { p_token: token });
    if (authErr) throw authErr;
    if (!authOk) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "claim") {
      const slug = String(body.outlet_slug || "");
      if (!slug) return new Response(JSON.stringify({ error: "outlet_slug_required" }), { status: 400, headers });
      const { data, error } = await sb.rpc("claim_simphony_job", { p_outlet_slug: slug });
      if (error) throw error;
      return new Response(JSON.stringify({ job: data || null }), { status: 200, headers });
    }

    if (action === "result") {
      const jobId = String(body.job_id || "");
      if (!jobId) return new Response(JSON.stringify({ error: "job_id_required" }), { status: 400, headers });

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
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers });
  }
});
