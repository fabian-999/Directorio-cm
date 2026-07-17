// ====== CONFIG ======
const SUPABASE_URL = "https://xqlabhsjpqqpezvfsohd.supabase.co";
const SUPABASE_KEY = "sb_publishable_BgF_8jI43XBSoBGSS6n8NA_qYXhyD8z"; // publishable/anon (OK para frontend)

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET_EVIDENCE = "evidence";
const FOLDER_SIGNATURES = "signatures";

// ====== HELPERS ======
const $ = (id) => document.getElementById(id);

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((v || "").trim());
}

function setOut(text) {
  const el = $("out");
  if (!el) return;
  el.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
}

function setWho(text) {
  const el = $("whoami");
  if (!el) return;
  el.textContent = text || "No autenticado";
}

function showLoginOnly() {
  $("loginCard")?.classList.remove("hidden");
  $("appCard")?.classList.add("hidden");
  setWho("No autenticado");
}

function showApp() {
  $("loginCard")?.classList.add("hidden");
  $("appCard")?.classList.remove("hidden");
}

async function requireSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("No hay sesión. Inicia sesión.");
  return data.session;
}

// ====== DEBUG TOGGLE ======
$("btnToggleDebug")?.addEventListener("click", () => {
  $("out").classList.toggle("hidden");
});

// ====== TABS ======
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const tabId = btn.dataset.tab;
    ["tabDashboard","tabAudits","tabFindings","tabEvidence","tabSign"].forEach(id => {
      $(id).classList.toggle("hidden", id !== tabId);
    });
  });
});

// ====== AUTH ======
$("btnLogin").addEventListener("click", async () => {
  setOut("Logueando…");
  try {
    const email = $("email").value.trim();
    const password = $("password").value;

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;

    setOut({ login: "ok", user: data.user });
    await refreshProfile();
  } catch (e) {
    setOut("ERROR login: " + (e?.message || String(e)));
  }
});

$("btnLogout").addEventListener("click", async () => {
  await sb.auth.signOut();
  showLoginOnly();
  $("profileBox").textContent = "Sesión cerrada. Inicia sesión…";
  setOut("Sesión cerrada.");
});

// ====== PROFILE ======
async function refreshProfile() {
  const session = await requireSession();

  // Mostrar UI app
  showApp();
  setWho(`Logueado: ${session.user.email}`);

  const { data: profile, error } = await sb
    .from("profiles")
    .select("id, full_name, role, area, is_active")
    .eq("id", session.user.id)
    .single();

  if (error) {
    $("profileBox").classList.add("warn");
    $("profileBox").textContent = "No pude cargar el perfil en profiles. Razón: " + error.message;
    return;
  }

  $("profileBox").classList.remove("warn");
  $("profileBox").innerHTML = `
    <b>Bienvenido ${profile.full_name}</b>
    <div class="muted">Rol: ${profile.role} · Área: ${profile.area ?? "-"} · Activo: ${profile.is_active ? "Sí" : "No"}</div>
  `;

  // KPI dashboard
  $("kpiName").textContent = profile.full_name ?? "—";
  $("kpiRole").textContent = profile.role ?? "—";
  $("kpiArea").textContent = profile.area ?? "—";
  $("kpiActive").textContent = profile.is_active ? "Sí" : "No";
}

// ====== INIT ======
(async () => {
  // Login-first UI
  showLoginOnly();
  setOut("Listo. Inicia sesión.");

  const { data } = await sb.auth.getSession();
  if (data.session) {
    setOut({ session: "activa" });
    await refreshProfile();
  }

  // Si cambia el auth (login/logout), refrescar UI
  sb.auth.onAuthStateChange(async (event) => {
    // Solo para debug
    console.log("Auth event:", event);

    if (event === "SIGNED_OUT") {
      showLoginOnly();
      return;
    }
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
      try { await refreshProfile(); } catch {}
    }
  });
})();

// ====== AUDITS ======
$("btnLoadAudits").addEventListener("click", loadAudits);
$("btnCreateAudit").addEventListener("click", createAudit);

async function loadAudits() {
  setOut("Cargando auditorías…");
  try {
    await requireSession();

    const { data, error } = await sb
      .from("audits")
      .select("id, title, area, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    if (!data?.length) {
      $("auditsBox").innerHTML = `<div class="muted">No hay auditorías (o RLS no deja ver).</div>`;
      return;
    }

    const rows = data.map(a => `
      <tr>
        <td><code>${a.id}</code></td>
        <td>${a.title ?? "-"}</td>
        <td>${a.area ?? "-"}</td>
        <td>${a.status ?? "-"}</td>
      </tr>
    `).join("");

    $("auditsBox").innerHTML = `
      <table>
        <thead><tr><th>ID</th><th>Título</th><th>Área</th><th>Estado</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="muted">Tip: copia el ID para Hallazgos/Evidencia/Firma.</div>
    `;

    setOut({ audits: data.length });
  } catch (e) {
    setOut("ERROR audits: " + (e?.message || String(e)));
    $("auditsBox").innerHTML = `<div class="muted">Revisa RLS de SELECT en audits.</div>`;
  }
}

async function createAudit() {
  setOut("Creando auditoría…");
  try {
    const session = await requireSession();

    const title = $("auditTitle").value.trim();
    const area = $("auditArea").value.trim();
    const status = $("auditStatus").value;

    if (!title) throw new Error("Falta título.");

    const payload = {
      title,
      area: area || null,
      status,
      created_by: session.user.id
    };

    const { data, error } = await sb
      .from("audits")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    setOut({ audit_created: data });
    await loadAudits();
  } catch (e) {
    setOut("ERROR crear audit: " + (e?.message || String(e)));
  }
}

// ====== FINDINGS ======
$("btnLoadFindings").addEventListener("click", loadFindings);
$("btnCreateFinding").addEventListener("click", createFinding);

async function loadFindings() {
  setOut("Cargando hallazgos…");
  try {
    await requireSession();

    const auditId = $("findingAuditId").value.trim();
    if (!isUuid(auditId)) throw new Error("Audit ID inválido (UUID).");

    const { data, error } = await sb
      .from("findings")
      .select("id, audit_id, title, severity, created_at")
      .eq("audit_id", auditId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    if (!data?.length) {
      $("findingsBox").innerHTML = `<div class="muted">No hay hallazgos para ese audit.</div>`;
      return;
    }

    const rows = data.map(f => `
      <tr>
        <td><code>${f.id}</code></td>
        <td>${f.title ?? "-"}</td>
        <td>${f.severity ?? "-"}</td>
      </tr>
    `).join("");

    $("findingsBox").innerHTML = `
      <table>
        <thead><tr><th>ID</th><th>Título</th><th>Severidad</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    setOut({ findings: data.length });
  } catch (e) {
    setOut("ERROR findings: " + (e?.message || String(e)));
    $("findingsBox").innerHTML = `<div class="muted">Revisa RLS de SELECT en findings.</div>`;
  }
}

async function createFinding() {
  setOut("Creando hallazgo…");
  try {
    const session = await requireSession();

    const auditId = $("findingAuditId").value.trim();
    const title = $("findingTitle").value.trim();
    const severity = $("findingSeverity").value;

    if (!isUuid(auditId)) throw new Error("Audit ID inválido (UUID).");
    if (!title) throw new Error("Falta título.");

    const payload = {
      audit_id: auditId,
      title,
      severity,
      owner_user_id: session.user.id
    };

    const { data, error } = await sb
      .from("findings")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    setOut({ finding_created: data });
    await loadFindings();
  } catch (e) {
    setOut("ERROR crear finding: " + (e?.message || String(e)));
  }
}

// ====== EVIDENCE ======
$("btnUploadEvidence").addEventListener("click", uploadEvidence);

async function uploadEvidence() {
  setOut("Subiendo evidencia…");
  try {
    const session = await requireSession();
    const file = $("evFile").files?.[0];
    if (!file) throw new Error("Selecciona un archivo.");

    const auditId = ($("evAuditId").value || "").trim() || null;
    const findingId = ($("evFindingId").value || "").trim() || null;

    if (auditId && !isUuid(auditId)) throw new Error("Audit ID no es UUID.");
    if (findingId && !isUuid(findingId)) throw new Error("Finding ID no es UUID.");

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${session.user.id}/${Date.now()}-${safeName}`;

    const up = await sb.storage
      .from(BUCKET_EVIDENCE)
      .upload(path, file, { upsert: false, contentType: file.type });

    if (up.error) throw up.error;

    const { data: pub } = sb.storage.from(BUCKET_EVIDENCE).getPublicUrl(path);
    const fileUrl = pub?.publicUrl || path;

    const payload = {
      audit_id: auditId,
      finding_id: findingId,
      file_url: fileUrl,
      file_name: file.name,
      file_type: file.type,
      uploaded_by: session.user.id
    };

    const { data, error } = await sb
      .from("evidence")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    $("evidenceBox").innerHTML = `
      <div class="toast"><b>✅ Evidencia subida</b><div class="muted">path: ${path}</div></div>
      <pre>${JSON.stringify(data, null, 2)}</pre>
    `;

    setOut({ evidence: "ok" });
  } catch (e) {
    setOut("ERROR evidencia: " + (e?.message || String(e)));
    $("evidenceBox").innerHTML = `<div class="muted">Si dice RLS/permission, toca ajustar policies (Storage o tabla evidence).</div>`;
  }
}

// ====== SIGNATURE ======
const canvas = $("sigCanvas");
const ctx = canvas.getContext("2d");
ctx.lineWidth = 3;
ctx.lineCap = "round";
ctx.strokeStyle = "#111";

let drawing = false;
let last = { x: 0, y: 0 };

function getPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const isTouch = evt.touches && evt.touches[0];
  const clientX = isTouch ? evt.touches[0].clientX : evt.clientX;
  const clientY = isTouch ? evt.touches[0].clientY : evt.clientY;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function startDraw(evt) { drawing = true; last = getPos(evt); }
function moveDraw(evt) {
  if (!drawing) return;
  evt.preventDefault();
  const pos = getPos(evt);
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  last = pos;
}
function endDraw() { drawing = false; }

canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", moveDraw);
window.addEventListener("mouseup", endDraw);

canvas.addEventListener("touchstart", startDraw, { passive: false });
canvas.addEventListener("touchmove", moveDraw, { passive: false });
window.addEventListener("touchend", endDraw);

$("btnClearSig").addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $("signOut").textContent = "Firma borrada ✅";
});

$("btnSaveSig").addEventListener("click", saveSignature);

function canvasToBlob() {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1.0));
}

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function saveSignature() {
  $("signOut").textContent = "Guardando firma…";
  try {
    const session = await requireSession();

    const targetType = $("signTargetType").value;
    const targetId = $("signTargetId").value.trim();
    const role = $("signRole").value;

    if (!isUuid(targetId)) throw new Error("Target ID debe ser UUID.");

    const blob = await canvasToBlob();
    if (!blob || blob.size < 2000) throw new Error("Firma vacía. Dibuja primero.");

    const docHash = await sha256Hex(JSON.stringify({
      targetType, targetId, signedBy: session.user.id, ts: new Date().toISOString()
    }));

    const fileName = `${FOLDER_SIGNATURES}/${targetId}_${session.user.id}_${Date.now()}.png`;

    const up = await sb.storage
      .from(BUCKET_EVIDENCE)
      .upload(fileName, blob, { upsert: false, contentType: "image/png" });

    if (up.error) throw up.error;

    const payload = {
      audit_id: targetType === "audit" ? targetId : null,
      finding_id: targetType === "finding" ? targetId : null,
      signed_by: session.user.id,
      signature_path: fileName,
      document_hash: docHash,
      signature_role: role,
      meta: { bucket: BUCKET_EVIDENCE, mimetype: "image/png", size: blob.size }
    };

    const { data, error } = await sb
      .from("report_signatures")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    $("signOut").textContent =
      "✅ Firma guardada.\n\n" +
      JSON.stringify(data, null, 2) +
      "\n\nStorage: " + `${BUCKET_EVIDENCE}/${fileName}`;

  } catch (e) {
    $("signOut").textContent = "ERROR firma: " + (e?.message || String(e));
  }
}
