// PROBE: confirms deploy + routing
app.get("/api/__routes_probe", (req, res) => {
  res.json({ ok: true, service: "album-backend", ts: new Date().toISOString() });
});

// PUBLISH: temporary minimal handler to kill 404 (wire real logic later)
app.post("/api/publish-minisite", (req, res) => {
  const { projectId, snapshotKey } = req.body || {};
  if (!projectId || !snapshotKey) {
    return res.status(400).json({ ok: false, error: "projectId and snapshotKey are required" });
  }
  return res.json({ ok: true, projectId, snapshotKey, note: "publish-minisite reached" });
});

