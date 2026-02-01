// FILE: src/minisite/catalogCore.js
// Minimal localStorage project store (single source of truth for Catalog persistence)

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

export function loadProject(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) return null;
  const raw = localStorage.getItem(projectKey(pid));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

export function saveProject(projectId, project) {
  const pid = String(projectId || "").trim();
  if (!pid) return;
  if (!project || typeof project !== "object") return;

  const next = { ...project, projectId: pid, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(projectKey(pid), JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
  return next;
}

export function ensureProject(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) return null;

  const existing = loadProject(pid);
  if (existing) return existing;

  const fresh = {
    projectId: pid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    catalog: { songs: [] },
  };
  saveProject(pid, fresh);
  return fresh;
}

export function setSection(projectId, sectionKey, sectionValue) {
  const pid = String(projectId || "").trim();
  if (!pid) return null;

  const current = ensureProject(pid) || { projectId: pid };
  const next = {
    ...current,
    [sectionKey]: sectionValue,
    updatedAt: new Date().toISOString(),
  };
  return saveProject(pid, next);
}
