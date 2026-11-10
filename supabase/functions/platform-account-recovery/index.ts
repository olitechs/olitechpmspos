import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://www.olitechs.co.ke",
  "https://olitechs.co.ke",
  "https://www.staging.olitechs.co.ke",
  "https://staging.olitechs.co.ke",
  "http://localhost:5173",
]);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://www.olitechs.co.ke",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!allowedOrigins.has(origin)) return new Response(JSON.stringify({ error: "Origin is not allowed." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Authentication required.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Recovery service is not configured.");

    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) throw new Error("Your session is invalid. Sign in again.");

    const { data: caller, error: callerError } = await adminClient
      .from("profiles").select("platform_role").eq("id", authData.user.id).single();
    if (callerError || caller?.platform_role !== "platform_owner") throw new Error("Only a platform owner can generate a recovery link.");

    const body = await req.json();
    const propertyId = String(body?.propertyId || "");
    const targetUserId = String(body?.userId || "");
    if (!/^[0-9a-f-]{36}$/i.test(propertyId) || !/^[0-9a-f-]{36}$/i.test(targetUserId)) throw new Error("A valid property and user are required.");

    const { data: membership, error: membershipError } = await adminClient
      .from("property_users").select("id").eq("property_id", propertyId).eq("user_id", targetUserId).maybeSingle();
    if (membershipError || !membership) throw new Error("That user is not a member of the selected property.");

    const { data: target, error: targetError } = await adminClient
      .from("profiles").select("id,email,platform_role").eq("id", targetUserId).single();
    if (targetError || !target?.email) throw new Error("The selected account has no recoverable email address.");
    if (target.platform_role === "platform_owner") throw new Error("Platform-owner recovery must use the platform's normal account recovery process.");

    const redirectTo = new URL("/reset-password", origin).toString();
    const { data: generated, error: generateError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: target.email,
      options: { redirectTo },
    });
    if (generateError) throw generateError;

    const { error: auditError } = await adminClient.from("audit_logs").insert({
      actor_id: authData.user.id,
      property_id: propertyId,
      action: "platform_property_account_recovery_link_generated",
      new_value: { target_user_id: targetUserId, delivery: "manual_share", redirect_to: redirectTo },
    });
    if (auditError) throw auditError;

    const actionLink = generated?.properties?.action_link;
    if (!actionLink) throw new Error("Supabase did not return a recovery link.");
    return new Response(JSON.stringify({
      actionLink,
      email: target.email,
      expiresInSeconds: generated?.properties?.expires_at ? Math.max(0, Math.floor((new Date(generated.properties.expires_at).getTime() - Date.now()) / 1000)) : null,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Unable to generate recovery link." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
});
