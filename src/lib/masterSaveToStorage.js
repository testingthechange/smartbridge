const keyFor = (projectId) =>
  `sb:lastMasterSaveKey:${String(projectId || "").trim()}`;

export function setLastMasterSaveKey(projectId, masterSaveKey) {
  if (!projectId || !masterSaveKey) return;
  try {
    localStorage.setItem(keyFor(projectId), String(masterSaveKey));
  } catch {}
}

export function getLastMasterSaveKey(projectId) {
  if (!projectId) return null;
  try {
    return localStorage.getItem(keyFor(projectId));
  } catch {
    return null;
  }
}

export function clearLastMasterSaveKey(projectId) {
  if (!projectId) return;
  try {
    localStorage.removeItem(keyFor(projectId));
  } catch {}
}
