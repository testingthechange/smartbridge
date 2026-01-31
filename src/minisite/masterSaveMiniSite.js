// FILE: src/minisite/masterSaveMiniSite.js
import { getApiBase } from "../lib/api/apiBase.js";

function projectKey(projectId) {
  return `project_${String(projectId || "").trim()}`;
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadProjectLocal(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) return null;
  const raw = localStorage.getItem(projectKey(pid));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

export async function masterSaveMiniSite({ projectId, project = null, apiBase = "" } = {}) {
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("masterSaveMiniSite: missing projectId");

  const base = String(apiBase || getApiBase() || "").replace(/\/+$/, "");
  if (!base) throw new Error("masterSaveMiniSite: missing api base");

  const localProject = project && typeof project === "object" ? project : loadProjectLocal(pid);
  if (!localProject || typeof localProject !== "object") {
    throw new Error(`masterSaveMiniSite: no local project found for projectId=${pid}`);
  }

  const res = await fetch(`${base}/api/master-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: pid, project: localProject }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok !== true) {
    throw new Error(json?.error || `Master Save failed (HTTP ${res.status})`);
  }

  return {
    ok: true,
    projectId: pid,
    snapshotKey: String(json?.snapshotKey || ""),
    latestKey: String(json?.latestKey || ""),
  };
}
