import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const token=()=>`${crypto.randomUUID().replaceAll("-","")}${crypto.randomUUID().replaceAll("-","")}`;

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    if(req.method!=="POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:cors});
    const auth=req.headers.get("authorization")||"";
    const jwt=auth.replace(/^Bearer\s+/i,"").trim();
    if(!jwt) return new Response(JSON.stringify({error:"Not authenticated"}),{status:401,headers:cors});
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
    const {data:userData,error:userError}=await admin.auth.getUser(jwt);
    if(userError||!userData.user) return new Response(JSON.stringify({error:"Invalid session"}),{status:401,headers:cors});
    const body=await req.json();
    const reportId=String(body?.report_id||"");
    const to=String(body?.to||"").trim();
    const recipientName=String(body?.recipient_name||"").trim();
    const note=String(body?.message||"").trim();
    const origin=String(body?.origin||"").replace(/\/$/,"");
    if(!reportId||!to) return new Response(JSON.stringify({error:"Report and recipient email are required"}),{status:400,headers:cors});
    const {data:report,error}=await admin.from("finalized_reports").select("id,user_id,report_code,title,period_start,period_end,share_token,share_expires_at,share_revoked_at,status").eq("id",reportId).eq("user_id",userData.user.id).maybeSingle();
    if(error) throw error;
    if(!report) return new Response(JSON.stringify({error:"Report not found"}),{status:404,headers:cors});

    let shareToken=report.share_token;
    if(!shareToken||report.share_revoked_at||(report.share_expires_at&&new Date(report.share_expires_at).getTime()<Date.now())){
      shareToken=token();
      await admin.from("finalized_reports").update({share_token:shareToken,share_revoked_at:null,share_expires_at:new Date(Date.now()+30*24*3600000).toISOString()}).eq("id",report.id);
    }
    const link=`${origin}?share=${shareToken}`;
    const brevoKey=Deno.env.get("BREVO_API_KEY")||"";
    const senderEmail=Deno.env.get("BREVO_SENDER_EMAIL")||"";
    const senderName=Deno.env.get("BREVO_SENDER_NAME")||"WorkWatch";
    if(!brevoKey||!senderEmail){
      return new Response(JSON.stringify({error:"Email provider is not configured",fallback:true,share_url:link}),{status:503,headers:cors});
    }

    const subject=`${report.title} — ${report.report_code}`;
    const html=`<div style="font-family:Arial,sans-serif;color:#101828;line-height:1.55"><p>${recipientName?`Hi ${recipientName},`:'Hello,'}</p><p>${note||'Please find my finalized WorkWatch time record below.'}</p><p><strong>${report.title}</strong><br>${report.period_start} – ${report.period_end}<br>Report ID: ${report.report_code}</p><p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:7px">View WorkWatch Report</a></p><p style="color:#667085;font-size:12px">Generated through WorkWatch • Developed by John Mark</p></div>`;
    const send=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":brevoKey,"content-type":"application/json","accept":"application/json"},body:JSON.stringify({sender:{name:senderName,email:senderEmail},to:[{email:to,name:recipientName||undefined}],subject,htmlContent:html})});
    const sendPayload=await send.json().catch(()=>({}));
    if(!send.ok) throw new Error(sendPayload?.message||"Brevo could not send the email");
    await admin.from("report_submissions").insert({report_id:report.id,user_id:userData.user.id,recipient:to,channel:"Email",notes:note});
    await admin.from("finalized_reports").update({status:"sent"}).eq("id",report.id).neq("status","acknowledged");
    return new Response(JSON.stringify({ok:true,share_url:link,message_id:sendPayload?.messageId||null}),{status:200,headers:cors});
  }catch(error){return new Response(JSON.stringify({error:error?.message||"Could not send report"}),{status:500,headers:cors});}
});
