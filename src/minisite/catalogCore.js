// FILE: src/minisite/catalogCore.js
// Local-only storage core (single source of truth for minisite state).
// No backend calls in this stage.

const PREFIX = "project_";

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function projectKey(projectId) {
  return `${PREFIX}${String(projectId || "").trim()}`;
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
  if (!pid) return null;

  const next =
    project && typeof project === "object"
      ? { ...project, projectId: pid, updatedAt: nowIso() }
      : null;

  if (!next) return null;

  localStorage.setItem(projectKey(pid), JSON.stringify(next));
  return next;
}

export function ensureProject(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) return null;

  const existing = loadProject(pid);
  if (existing) return existing;

  const base = {
    projectId: pid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    catalog: { songs: [] },
    album: {
      playlistOrder: Array.from({ length: 9 }, (_, i) => i + 1),
      locks: { playlistComplete: false, metaComplete: false, coverComplete: false },
      meta: { albumTitle: "", artistName: "", releaseDate: "" },
      cover: { fileName: "", s3Key: "", previewUrl: "" },
      masterSave: null,
    },
    master: { isMasterSaved: false, masterSavedAt: "", lastSnapshotKey: "" },
    publish: { snapshotKey: "" },
  };

  return saveProject(pid, base);
}

export function setSection(projectId, sectionKey, sectionValue) {
  const pid = String(projectId || "").trim();
  if (!pid) return null;

  const current = loadProject(pid) || ensureProject(pid) || {};
  const next = {
    ...current,
    [sectionKey]: sectionValue,
    updatedAt: nowIso(),
  };

  return saveProject(pid, next);
}
