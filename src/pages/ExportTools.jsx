import React, { useMemo, useState } from "react";
import { useMiniSiteProject } from "../ProjectMiniSiteContext.jsx";
import { runS3Converter } from "../lib/runS3Converter.js";

export default function ExportTools() {
  const { projectId, isMasterSaved, lastMasterSaveKey } = useMiniSiteProject();

  const [snapshotKey, setSnapshotKey] = useState(lastMasterSaveKey || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);

  const canConvert = useMemo(() => !!projectId && !!snapshotKey && !busy, [projectId, snapshotKey, busy]);

  async function onConvert() {
    if (!canConvert) return;
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const out = await runS3Converter({ projectId, snapshotKey });
      setResult(out || { ok: true, outputs: [] });
    } catch (e) {
      setErr(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a" }}>Export / Tools</div>

      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75, lineHeight: 1.4 }}>
        Converter pipeline: <strong>Master Save snapshot</strong> → <strong>converter</strong> → <strong>S3-ready outputs</strong>.
        <div style={{ marginTop: 4 }}>
          Project: <code style={code}>{projectId || "—"}</code>
        </div>
      </div>

      {!isMasterSaved ? (
        <div style={warn}>
          ⚠️ No Master Save detected. You can still test with any snapshotKey, but normally you convert the last Master Save.
        </div>
      ) : null}

      <div style={panel}>
        <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 10 }}>S3 Converter</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
          <div>
            <div style={label}>Snapshot Key</div>
            <input
              value={snapshotKey}
              onChange={(e) => setSnapshotKey(e.target.value)}
              placeholder="e.g. mastersave/project_123456/2025-12-18T..."
              style={input}
              disabled={busy}
            />
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
              Tip: defaults to lastMasterSaveKey when available.
            </div>
          </div>

          <button
            type="button"
            onClick={onConvert}
            disabled={!canConvert}
            style={!canConvert ? btnDisabled : btn}
            title={!projectId ? "Missing projectId" : !snapshotKey ? "Missing snapshotKey" : ""}
          >
            {busy ? "Converting..." : "Run Converter"}
          </button>
        </div>

        {err ? <div style={{ marginTop: 10, color: "crimson", fontWeight: 700, whiteSpace: "pre-wrap" }}>{err}</div> : null}

        {result ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900 }}>Result</div>
            <pre style={pre}>{JSON.stringify(result, null, 2)}</pre>

            {Array.isArray(result.outputs) && result.outputs.length ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 900 }}>Outputs</div>
                <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
                  {result.outputs.map((o, idx) => (
                    <div key={o.key || idx} style={outCard}>
                      <div style={{ fontWeight: 900 }}>{o.label || o.type || "Output"}</div>
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                        key: <code style={code}>{o.key || "—"}</code>
                      </div>
                      {o.publicUrl ? (
                        <div style={{ marginTop: 8 }}>
                          <a href={o.publicUrl} target="_blank" rel="noreferrer" style={linkBtn}>
                            Open
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const panel = {
  marginTop: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 14,
  background: "#fff",
};

const warn = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(244,63,94,0.25)",
  background: "rgba(244,63,94,0.08)",
  color: "#9f1239",
  fontWeight: 800,
};

const label = { fontSize: 12, fontWeight: 900, opacity: 0.75, textTransform: "uppercase" };

const input = {
  width: "100%",
  padding: "12px 12px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  fontSize: 14,
  outline: "none",
};

const btn = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#111827",
  color: "#f9fafb",
  fontSize: 14,
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const btnDisabled = {
  ...btn,
  background: "#e5e7eb",
  border: "1px solid #e5e7eb",
  color: "#6b7280",
  cursor: "not-allowed",
};

const pre = {
  marginTop: 8,
  padding: 12,
  borderRadius: 12,
  background: "#0b1220",
  color: "#e5e7eb",
  fontSize: 12,
  overflowX: "auto",
};

const outCard = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 12,
  background: "#fff",
};

const code = {
  display: "inline-block",
  padding: "2px 6px",
  borderRadius: 8,
  background: "rgba(15,23,42,0.06)",
  border: "1px solid rgba(15,23,42,0.10)",
  fontSize: 12,
};

const linkBtn = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#111827",
  color: "#f9fafb",
  fontSize: 13,
  fontWeight: 900,
  textDecoration: "none",
};
