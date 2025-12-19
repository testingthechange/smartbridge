// src/pages/Projects.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function safeString(v) {
  return String(v ?? "").trim();
}

function projectKey(projectId) {
  return `project_${projectId}`;
}

function generate6DigitId(existingIdsSet) {
  // best-effort unique
  for (let i = 0; i < 50; i++) {
    const n = Math.floor(Math.random() * 900000) + 100000;
    const id = String(n);
    if (!existingIdsSet.has(id)) return id;
  }
  // fallback
  return String(Date.now()).slice(-6);
}

function loadProjectsIndex() {
  const raw = localStorage.getItem("projects_index");
  const parsed = raw ? safeParse(raw) : null;
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function saveProjectsIndex(rows) {
  localStorage.setItem("projects_index", JSON.stringify(rows || []));
}

export default function Projects() {
  const [rows, setRows] = useState(() => loadProjectsIndex());

  const [form, setForm] = useState({
    projectName: "",
    date: "",
    producer: "",
    company: "",
  });

  useEffect(() => {
    saveProjectsIndex(rows);
  }, [rows]);

  const existingIds = useMemo(() => new Set(rows.map((r) => String(r.projectId))), [rows]);

  const onCreate = () => {
    const projectName = safeString(form.projectName);
    if (!projectName) {
      window.alert("Project Name required.");
      return;
    }

    const projectId = generate6DigitId(existingIds);
    const nowIso = new Date().toISOString();

    const newRow = {
      projectId,
      projectName,
      date: safeString(form.date),
      producer: safeString(form.producer),
      company: safeString(form.company),
      createdAt: nowIso,
      updatedAt: nowIso,

      // magic link state
      magic: {
        token: "",
        active: false,
        expiresAt: "",
        sentAt: "",
      },

      // master save state
      master: {
        isMasterSaved: false,
        masterSavedAt: "",
        lastSnapshotKey: "",
        producerReturnReceived: false,
        producerReturnReceivedAt: "",
      },
    };

    // seed project storage object
    const key = projectKey(projectId);
    const seed = {
      projectId,
      projectName,
      producer: newRow.producer,
      company: newRow.company,
      date: newRow.date,
      createdAt: nowIso,
      updatedAt: nowIso,
      catalog: { songs: [] },
      album: { meta: {} },
      meta: { songs: [] },
      magic: newRow.magic,
      master: newRow.master,
    };
    localStorage.setItem(key, JSON.stringify(seed));

    setRows((prev) => [newRow, ...prev]);
    setForm({ projectName: "", date: "", producer: "", company: "" });
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ fontSize: 26, fontWeight: 900, color: "#0f172a" }}>Projects</div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
        Create projects here. Clicking a Project ID opens the Project page (magic link + status).
      </div>

      <div
        style={{
          marginTop: 14,
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          padding: 14,
          background: "#fff",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Create Project</div>

        <div
          style={{
            marginTop: 10,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          <Field
            label="Project Name"
            value={form.projectName}
            onChange={(v) => setForm((p) => ({ ...p, projectName: v }))}
            placeholder="e.g. Maya — Album Return"
          />
          <Field
            label="Date"
            value={form.date}
            onChange={(v) => setForm((p) => ({ ...p, date: v }))}
            placeholder="YYYY-MM-DD"
          />
          <Field
            label="Producer"
            value={form.producer}
            onChange={(v) => setForm((p) => ({ ...p, producer: v }))}
            placeholder="Producer name"
          />
          <Field
            label="Company"
            value={form.company}
            onChange={(v) => setForm((p) => ({ ...p, company: v }))}
            placeholder="Company / label"
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={onCreate}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #111827",
              background: "#111827",
              color: "#f9fafb",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Create Project (auto 6-digit ID)
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Project List</div>

        <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ display: "flex", padding: 12, background: "#f8fafc", borderBottom: "1px solid #e5e7eb" }}>
            <div style={{ width: 110, fontWeight: 900, fontSize: 12, opacity: 0.7 }}>Project ID</div>
            <div style={{ flex: 1, fontWeight: 900, fontSize: 12, opacity: 0.7 }}>Project</div>
            <div style={{ width: 170, fontWeight: 900, fontSize: 12, opacity: 0.7 }}>Producer</div>
            <div style={{ width: 150, fontWeight: 900, fontSize: 12, opacity: 0.7 }}>Status</div>
          </div>

          {(rows || []).map((r) => {
            const isMasterSaved = !!r?.master?.isMasterSaved;
            const returnReceived = !!r?.master?.producerReturnReceived;
            return (
              <div
                key={r.projectId}
                style={{ display: "flex", padding: 12, borderBottom: "1px solid #eef2f7", background: "#fff" }}
              >
                <div style={{ width: 110, fontFamily: "monospace", fontWeight: 900 }}>
                  <Link to={`/projects/${r.projectId}`} style={{ textDecoration: "none", color: "#111827" }}>
                    {r.projectId}
                  </Link>
                </div>
                <div style={{ flex: 1, fontWeight: 800, color: "#0f172a" }}>{r.projectName}</div>
                <div style={{ width: 170, opacity: 0.85 }}>{r.producer || "—"}</div>
                <div style={{ width: 150, fontWeight: 900 }}>
                  {returnReceived ? "✅ Return" : isMasterSaved ? "✅ Master" : "—"}
                </div>
              </div>
            );
          })}

          {!rows?.length ? <div style={{ padding: 12, background: "#fff" }}>No projects yet.</div> : null}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7, textTransform: "uppercase" }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "12px 12px",
          borderRadius: 12,
          border: "1px solid #d1d5db",
          fontSize: 15,
          outline: "none",
          background: "#fff",
        }}
      />
    </div>
  );
}
