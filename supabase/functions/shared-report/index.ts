import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

const hashText = async (value: string) => {
  if (!value) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    let token = "";
    let action = "view";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      token = String(body?.token || "").trim();
      action = String(body?.action || "view").trim();
    } else {
      const url = new URL(req.url);
      token = (url.searchParams.get("token") || "").trim();
    }

    if (!token || token.length < 24) {
      return new Response(JSON.stringify({ error: "Invalid share token" }), { status: 400, headers: cors });
    }

    const { data: report, error } = await admin
      .from("finalized_reports")
      .select("id,report_code,title,period_start,period_end,snapshot,finalized_at,share_expires_at,share_revoked_at,verification_code,version_no,amendment_reason,status,view_count,acknowledged_at")
      .eq("share_token", token)
      .maybeSingle();

    if (error) throw error;
    if (!report || report.share_revoked_at || report.status === "revoked") {
      return new Response(JSON.stringify({ error: "Share link not found or revoked" }), { status: 404, headers: cors });
    }
    if (report.share_expires_at && new Date(report.share_expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: "This share link has expired" }), { status: 410, headers: cors });
    }

    if (req.method === "POST" && action === "acknowledge") {
      const now = new Date().toISOString();
      await admin.from("finalized_reports").update({ acknowledged_at: now, status: "acknowledged" }).eq("id", report.id);
      return new Response(JSON.stringify({ ok: true, acknowledged_at: now }), { status: 200, headers: { ...cors, "Cache-Control": "no-store" } });
    }

    const now = new Date().toISOString();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "";
    const userAgent = req.headers.get("user-agent") || "";
    await admin.from("report_view_events").insert({ report_id: report.id, user_agent: userAgent.slice(0, 500), ip_hash: await hashText(ip) });
    const nextStatus = report.status === "acknowledged" ? "acknowledged" : "viewed";
    await admin.from("finalized_reports").update({
      first_viewed_at: report.view_count ? undefined : now,
      last_viewed_at: now,
      view_count: Number(report.view_count || 0) + 1,
      status: nextStatus
    }).eq("id", report.id);

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
        verification_code: report.verification_code,
        version_no: report.version_no,
        amendment_reason: report.amendment_reason,
        status: nextStatus,
        view_count: Number(report.view_count || 0) + 1,
        acknowledged_at: report.acknowledged_at,
        snapshot
      }
    }), { status: 200, headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Could not load shared report" }), { status: 500, headers: cors });
  }
});
