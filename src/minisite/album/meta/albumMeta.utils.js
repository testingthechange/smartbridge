export async function fetchPlaybackUrl(API_BASE, s3Key) {
  const qs = new URLSearchParams({ s3Key });
  const r = await fetch(`${API_BASE}/api/playback-url?${qs.toString()}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) return "";
  return String(j.url || "");
}

export function fmtTime(s) {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function fmtBytes(b) {
  const n = Number(b) || 0;
  if (n <= 0) return "0B";
  const mb = n / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)}MB`;
  const kb = n / 1024;
  if (kb >= 1) return `${kb.toFixed(0)}KB`;
  return `${n}B`;
}

export function shorten(str, n) {
  if (!str) return "";
  if (str.length <= n) return str;
  return str.slice(0, Math.max(0, n - 1)) + "…";
}

export function uid() {
  try {
    return crypto?.randomUUID?.() || `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  } catch {
    return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }
}

export function safeRevoke(url) {
  if (!url) return;
  if (typeof url === "string" && url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }
}
