// src/minisite/album/projectLocal.js
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

export function loadProjectLocal(projectId) {
  if (!projectId) return null;
  const raw = localStorage.getItem(projectKey(projectId));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

export function saveProjectLocal(projectId, obj) {
  if (!projectId) return;
  localStorage.setItem(projectKey(projectId), JSON.stringify(obj || {}));
}
