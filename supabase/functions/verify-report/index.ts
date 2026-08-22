import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Content-Type":"application/json"};

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const code=(new URL(req.url).searchParams.get("code")||"").trim().toUpperCase();
    if(!code||code.length<8) return new Response(JSON.stringify({error:"Invalid verification code"}),{status:400,headers:cors});
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
    const {data,error}=await admin.from("finalized_reports").select("report_code,title,period_start,period_end,finalized_at,verification_code,version_no,amendment_reason,status,view_count,acknowledged_at,snapshot").eq("verification_code",code).maybeSingle();
    if(error) throw error;
    if(!data) return new Response(JSON.stringify({error:"Report not found"}),{status:404,headers:cors});
    const entries=Array.isArray(data.snapshot?.entries)?data.snapshot.entries:[];
    const recorded_ms=entries.reduce((sum:number,e:any)=>sum+Math.max(0,new Date(e.ended_at).getTime()-new Date(e.started_at).getTime()-Number(e.break_seconds||0)*1000),0);
    return new Response(JSON.stringify({report:{report_code:data.report_code,title:data.title,period_start:data.period_start,period_end:data.period_end,finalized_at:data.finalized_at,verification_code:data.verification_code,version_no:data.version_no,amendment_reason:data.amendment_reason,status:data.status,view_count:data.view_count,acknowledged_at:data.acknowledged_at,full_name:data.snapshot?.profile?.name||"",tasks:entries.length,recorded_ms}}),{status:200,headers:{...cors,"Cache-Control":"no-store"}});
  }catch(error){return new Response(JSON.stringify({error:error?.message||"Could not verify report"}),{status:500,headers:cors});}
});
