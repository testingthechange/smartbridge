// src/minisite/masterSaveMiniSite.js
// (If your path is src/lib/masterSaveMiniSite.js, paste it there instead.)

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function projectKey(projectId) {
  return `project_${projectId}`;
}

function snapshotKey(projectId, iso) {
  return `masterSnapshot_${projectId}_${iso.replaceAll(":", "-")}`;
}

/**
 * Master Save (local mode):
 * - Accepts { projectId, project } but ALSO works if either is missing
 * - Reads from localStorage: project_<projectId>
 * - Writes:
 *    1) snapshot stored at masterSnapshot_<projectId>_<timestamp>
 *    2) project_<projectId>.masterSave.lastMasterSaveKey / lastMasterSavedAt
 * - Returns { ok:true, snapshotKey, masterSavedAt }
 */
export async function masterSaveMiniSite(input = {}) {
  // Allow callers to pass partial info
  let pid = typeof input?.projectId === "string" ? input.projectId.trim() : "";
  let project = input?.project || null;

  // If pid missing but project contains id, use it
  if (!pid && project) {
    pid = String(project.projectId || project.id || "").trim();
  }

  // If still missing pid, hard fail (nothing we can do)
  if (!pid) {
    throw new Error(JSON.stringify({ ok: false, error: "Missing projectId or project" }));
  }

  // If project missing, load it
  if (!project) {
    const raw = localStorage.getItem(projectKey(pid));
    project = raw ? safeParse(raw) : null;
  }

  if (!project) {
    throw new Error(JSON.stringify({ ok: false, error: "Missing projectId or project" }));
  }

  const now = new Date().toISOString();
  const snapKey = snapshotKey(pid, now);

  // Snapshot is the full project frozen
  const snapshot = {
    projectId: pid,
    capturedAt: now,
    project,
  };

  // Store snapshot under its own key
  localStorage.setItem(snapKey, JSON.stringify(snapshot));

  // Update project masterSave pointers
  const nextProject = {
    ...project,
    masterSave: {
      ...(project.masterSave || {}),
      lastMasterSaveKey: snapKey,
      lastMasterSavedAt: now,
    },
    updatedAt: now,
  };

  localStorage.setItem(projectKey(pid), JSON.stringify(nextProject));

  // Notify listeners
  window.dispatchEvent(new CustomEvent("project-updated", { detail: { projectId: pid } }));
  window.dispatchEvent(new CustomEvent("master-save", { detail: { projectId: pid, snapshotKey: snapKey, at: now } }));

  return { ok: true, snapshotKey: snapKey, masterSavedAt: now };
}
