// supabase/functions/delete-user/index.ts
// Borra completamente un usuario del sistema: Auth + profiles
// Requiere que el que llama sea admin (validado con service_role para evitar problemas de RLS/policies).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const token = h.replace(/bearer\s+/i, "").trim();
  return token ? token : null;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, {
        error: "Missing server env vars",
        detail: "Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const token = getBearerToken(req);
    if (!token) return json(401, { error: "Missing JWT" });

    const body = (await req.json().catch(() => ({}))) as { user_id?: string };
    const user_id = body?.user_id?.trim();
    if (!user_id) return json(400, { error: "user_id requerido" });

    // 1) Validar que el JWT sea real (no depende de policies)
    const sbCaller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: callerAuth, error: callerAuthErr } = await sbCaller.auth.getUser();
    if (callerAuthErr || !callerAuth?.user) {
      return json(401, { error: "Invalid JWT", detail: callerAuthErr?.message ?? null });
    }

    // (Opcional) Evitar que el admin se borre a sí mismo
    if (callerAuth.user.id === user_id) {
      return json(400, { error: "No puedes eliminar tu propio usuario admin." });
    }

    // 2) Validar admin con SERVICE ROLE (evita recursión/infinite recursion en policies)
    const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // OJO: esto lee profiles con service_role, así que NO dispara RLS/policies.
    const { data: callerProfile, error: callerProfileErr } = await sbAdmin
      .from("profiles")
      .select("role, is_active")
      .eq("id", callerAuth.user.id)
      .maybeSingle();

    if (callerProfileErr) {
      return json(500, { error: "Error leyendo perfil del admin", detail: callerProfileErr.message });
    }
    if (!callerProfile) return json(403, { error: "Tu usuario no tiene perfil en profiles" });

    const role = String((callerProfile as any).role ?? "");
    const is_active = Boolean((callerProfile as any).is_active);

    if (role !== "admin" || is_active !== true) {
      return json(403, { error: "Forbidden: admin only" });
    }

    // 3) Borrar PERFIL (si existe)
    const { error: profDelErr } = await sbAdmin.from("profiles").delete().eq("id", user_id);
    if (profDelErr) {
      return json(400, { error: "No se pudo borrar el perfil", detail: profDelErr.message });
    }

    // 4) Borrar AUTH USER
    const { error: authDelErr } = await sbAdmin.auth.admin.deleteUser(user_id);
    if (authDelErr) {
      return json(400, { error: "No se pudo borrar el usuario de Auth", detail: authDelErr.message });
    }

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: "Unhandled error", detail: String((e as Error)?.message ?? e) });
  }
});
