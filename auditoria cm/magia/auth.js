/* auth.js (v2) - Cliente Supabase + sesión + perfil (global)
   - Usa SOLO la publishable key (anon) en frontend.
   - Mantiene sesión en localStorage (persistSession=true).
   - Expone helpers en window: sb, requireSession, fetchProfile, signInWithPassword, signOut.
*/

(() => {
  // ===== CONFIG (PON TUS VALORES) =====
  // IMPORTANTE: no pongas la secret key aquí.
  const SUPABASE_URL = window.SUPABASE_URL || "https://xqlabhsjpqqpezvfsohd.supabase.co";
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "sb_publishable_BgF_8jI43XBSoBGSS6n8NA_qYXhyD8z";

  // ===== CLIENTE (singleton) =====
  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase UMD no está cargado. Asegúrate de incluir el <script> de supabase-js antes de auth.js");
  }

  // Evita redeclaraciones entre páginas
  window.sb = window.sb || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // ===== HELPERS =====
  async function requireSession({ redirectTo = "index.html" } = {}) {
    const { data, error } = await window.sb.auth.getSession();
    if (error) throw error;

    const session = data?.session || null;
    if (!session) {
      // sin sesión -> manda al login
      if (redirectTo) window.location.href = redirectTo;
      return null;
    }
    return session;
  }

  async function signInWithPassword(email, password) {
    const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut({ redirectTo = "index.html" } = {}) {
    await window.sb.auth.signOut();
    if (redirectTo) window.location.href = redirectTo;
  }

  // Lee perfil desde public.profiles (id = auth.uid()).
  // OJO: si tu policy de profiles usa is_admin() que lee profiles, puede causar recursion.
  async function fetchProfile(uid) {
    if (!uid) return null;
    const { data, error } = await window.sb
      .from("profiles")
      .select("id, full_name, role, area, is_active, created_at")
      .eq("id", uid)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  // Exponer en window (para usarlo en cualquier HTML sin imports)
  window.requireSession = requireSession;
  window.fetchProfile = fetchProfile;
  window.signInWithPassword = signInWithPassword;
  window.signOut = signOut;

  // Para debug controlado (opcional)
  window.__AUTH_READY__ = true;
})();
