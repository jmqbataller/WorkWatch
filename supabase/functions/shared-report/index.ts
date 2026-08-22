import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim();
    if (!token || token.length < 24) {
      return new Response(JSON.stringify({ error: "Invalid share token" }), { status: 400, headers: cors });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const { data: report, error } = await admin
      .from("finalized_reports")
      .select("id,report_code,title,period_start,period_end,snapshot,finalized_at,share_expires_at,share_revoked_at")
      .eq("share_token", token)
      .maybeSingle();

    if (error) throw error;
    if (!report || report.share_revoked_at) {
      return new Response(JSON.stringify({ error: "Share link not found or revoked" }), { status: 404, headers: cors });
    }
    if (report.share_expires_at && new Date(report.share_expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: "This share link has expired" }), { status: 410, headers: cors });
    }

    const snapshot = structuredClone(report.snapshot || {});
    const signPath = async (path?: string | null) => {
      if (!path) return null;
      const { data } = await admin.storage.from("evidence").createSignedUrl(path, 3600);
      return data?.signedUrl || null;
    };

    if (Array.isArray(snapshot.entries)) {
      for (const entry of snapshot.entries) {
        entry.before_url = await signPath(entry.before_path);
        entry.after_url = await signPath(entry.after_path);
        if (Array.isArray(entry.during_evidence)) {
          for (const item of entry.during_evidence) item.url = await signPath(item.path);
        }
      }
    }

    return new Response(JSON.stringify({
      report: {
        report_code: report.report_code,
        title: report.title,
        period_start: report.period_start,
        period_end: report.period_end,
        finalized_at: report.finalized_at,
        snapshot
      }
    }), { status: 200, headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Could not load shared report" }), { status: 500, headers: cors });
  }
});
