// supabase/functions/create-user/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (m) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    } as Record<string, string>)[m]
  );
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendWelcomeEmail(params: {
  to: string;
  fullName?: string;
  tempPassword: string;
  role: string;
  area?: string;
}) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL = Deno.env.get("FROM_EMAIL"); // Ej: "CM Colombia <onboarding@resend.dev>" o "no-reply@tudominio.com"
  const LOGO_URL = Deno.env.get("LOGO_URL") || "";

  if (!RESEND_API_KEY) throw new Error("Missing env: RESEND_API_KEY");
  if (!FROM_EMAIL) throw new Error("Missing env: FROM_EMAIL");
  if (!FROM_EMAIL.includes("@")) throw new Error("FROM_EMAIL must be a valid email (or 'Name <email@domain>')");

  const name = (params.fullName || "").trim();
  const safeName = name ? escapeHtml(name) : "Usuario";
  const safeRole = escapeHtml(params.role || "user");
  const safeArea = escapeHtml(params.area || "-");
  const safePass = escapeHtml(params.tempPassword);

  const html = `
  <div style="font-family:Arial,sans-serif;background:#f6fbf7;padding:24px;">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e6efe8;border-radius:14px;overflow:hidden;">
      <div style="padding:18px 20px;background:linear-gradient(180deg,#7CC242,#2D8A3C);color:#fff;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${LOGO_URL ? `<img src="${LOGO_URL}" alt="Logo" style="height:44px;width:auto;background:#fff;border-radius:10px;padding:6px;">` : ""}
          <div style="font-size:16px;font-weight:800;">CM Colombia</div>
        </div>
      </div>

      <div style="padding:20px;">
        <h2 style="margin:0 0 10px;font-size:18px;">Tu usuario ha sido creado</h2>
        <p style="margin:0 0 14px;color:#334155;">Hola <b>${safeName}</b>, ya puedes ingresar al sistema.</p>

        <div style="border:1px solid #e6efe8;border-radius:12px;padding:14px;background:#fbfffc;">
          <div style="margin-bottom:8px;"><b>Correo:</b> ${escapeHtml(params.to)}</div>
          <div style="margin-bottom:8px;"><b>Rol:</b> ${safeRole}</div>
          <div style="margin-bottom:8px;"><b>Área:</b> ${safeArea}</div>
          <div><b>Contraseña temporal:</b> <span style="font-family:monospace;">${safePass}</span></div>
        </div>

        <p style="margin:14px 0 0;color:#64748b;font-size:12px;">
          Recomendación: cambia tu contraseña al ingresar.
        </p>
      </div>
    </div>
  </div>
  `;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [params.to],
      subject: "Tu usuario ha sido creado",
      html,
    }),
  });

  const txt = await r.text();
  console.log("Resend response:", r.status, txt);

  if (!r.ok) {
    throw new Error(`Resend error (${r.status}): ${txt}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!url || !serviceRoleKey || !anonKey) {
      return json(500, {
        error: "Missing env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY)",
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json(401, { error: "Unauthorized: missing Bearer token" });

    const sbCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: callerUser, error: callerUserErr } = await sbCaller.auth.getUser();
    if (callerUserErr || !callerUser?.user) return json(401, { error: "Invalid session" });

    const { data: callerProfile, error: callerProfileErr } = await sbCaller
      .from("profiles")
      .select("role,is_active")
      .eq("id", callerUser.user.id)
      .single();

    if (
      callerProfileErr ||
      !callerProfile ||
      callerProfile.role !== "admin" ||
      callerProfile.is_active !== true
    ) {
      return json(403, { error: "Forbidden: admin only" });
    }

    const body = await req.json().catch(() => ({}));

    const email = String((body as any).email || "").trim().toLowerCase();
    const password = String((body as any).password || "");
    const full_name = String((body as any).full_name || "").trim();
    const area = String((body as any).area || "").trim();
    const role = String((body as any).role || "user").trim();
    const is_active_new = (body as any).is_active === false ? false : true;

    if (!email) return json(400, { error: "email requerido" });
    if (!isValidEmail(email)) return json(400, { error: "email inválido" });
    if (!password || password.length < 8) return json(400, { error: "password mínimo 8 caracteres" });

    const allowedRoles = new Set(["admin", "auditor", "user"]);
    const finalRole = allowedRoles.has(role) ? role : "user";

    const sbAdmin = createClient(url, serviceRoleKey);

    const { data: created, error: createErr } = await sbAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr) return json(400, { error: createErr.message });

    const newUserId = created.user?.id;
    if (!newUserId) return json(500, { error: "No user id returned" });

    const { error: upErr } = await sbAdmin.from("profiles").upsert({
      id: newUserId,
      email,
      full_name,
      area,
      role: finalRole,
      is_active: is_active_new,
    });

    if (upErr) return json(500, { error: upErr.message });

    // 👇 Email NO bloquea creación
    let emailed = false;
    let email_error: string | null = null;

    try {
      await sendWelcomeEmail({
        to: email,
        fullName: full_name,
        tempPassword: password,
        role: finalRole,
        area,
      });
      emailed = true;
    } catch (e) {
      email_error = (e as Error).message ?? String(e);
      console.log("Email failed but user created:", email_error);
    }

    return json(200, {
      ok: true,
      id: newUserId,
      email,
      role: finalRole,
      emailed,
      ...(email_error ? { email_error } : {}),
    });
  } catch (e) {
    console.error("create-user fatal:", e);
    return json(500, { error: (e as Error).message ?? String(e) });
  }
});