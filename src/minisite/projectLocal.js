// src/minisite/projectLocal.js
function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

function safeString(v) {
  return String(v ?? "").trim();
}

function projectKey(projectId) {
  return `project_${safeString(projectId)}`;
}

export function loadProject(projectId) {
  const raw = localStorage.getItem(projectKey(projectId));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

export function saveProject(projectId, next) {
  localStorage.setItem(projectKey(projectId), JSON.stringify(next || {}));
  return next;
}
