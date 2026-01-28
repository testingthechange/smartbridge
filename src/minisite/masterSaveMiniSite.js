// FILE: src/lib/masterSaveMiniSite.js
// Master Save client helper (writes full local project -> backend -> S3)
//
// Backend contract (server.js):
// POST /api/master-save
// Body: { projectId: string, project: object }
// Returns: { ok:true, snapshotKey:string, latestKey:string }

import { loadProject } from "../minisite/catalog/catalogCore.js";

const DEFAULT_API_BASE = String(import.meta.env.VITE_API_BASE || "https://album-backend-c7ed.onrender.com").replace(
  /\/+$/,
  ""
);

export async function masterSaveMiniSite({ projectId, project = null, apiBase = DEFAULT_API_BASE } = {}) {
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("masterSaveMiniSite: missing projectId");

  const base = String(apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");

  // If caller didn't pass a project, use the canonical localStorage project_{projectId}.
  const localProject = project && typeof project === "object" ? project : loadProject(pid);
  if (!localProject || typeof localProject !== "object") {
    throw new Error(`masterSaveMiniSite: no local project found for projectId=${pid}`);
  }

  const res = await fetch(`${base}/api/master-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: pid,
      project: localProject,
    }),
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
