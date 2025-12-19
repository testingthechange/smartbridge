// src/pages/Project.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

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

function loadProjectsIndex() {
  const raw = localStorage.getItem("projects_index");
  const parsed = raw ? safeParse(raw) : null;
  return Array.isArray(parsed) ? parsed : [];
}

function saveProjectsIndex(rows) {
  localStorage.setItem("projects_index", JSON.stringify(rows || []));
}

function loadProject(projectId) {
  const raw = localStorage.getItem(projectKey(projectId));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

function saveProject(projectId, nextObj) {
  localStorage.setItem(projectKey(projectId), JSON.stringify(nextObj));
}

function makeToken() {
  return `ml_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function addHoursIso(hours) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

export default function Project() {
  const { projectId } = useParams();

  const [indexRows, setIndexRows] = useState(() => loadProjectsIndex());
  const [project, setProject] = useState(() => loadProject(projectId));

  useEffect(() => {
    setIndexRows(loadProjectsIndex());
    setProject(loadProject(projectId));
  }, [projectId]);

  const row = useMemo(() => indexRows.find((r) => String(r.projectId) === String(projectId)) || null, [indexRows, projectId]);

  const magic = project?.magic || row?.magic || { token: "", active: false, expiresAt: "", sentAt: "" };
  const master = project?.master || row?.master || { isMasterSaved: false, masterSavedAt: "", lastSnapshotKey: "" };

  const miniBase = `/minisite/${projectId}`;
  const tokenQuery = magic?.token ? `?token=${encodeURIComponent(magic.token)}` : `?token=demo`;

  const miniLinks = [
    { label: "Catalog", to: `${miniBase}/catalog${tokenQuery}` },
    { label: "Album", to: `${miniBase}/album${tokenQuery}` },
    { label: "Meta", to: `${miniBase}/meta${tokenQuery}` },
  ];

  const updateEverywhere = (nextProject, patchRowFn) => {
    // project storage
    saveProject(projectId, nextProject);
    setProject(nextProject);

    // index row mirror
    const nextRows = indexRows.map((r) => {
      if (String(r.projectId) !== String(projectId)) return r;
      const base = { ...r };
      return patchRowFn ? patchRowFn(base) : base;
    });
    saveProjectsIndex(nextRows);
    setIndexRows(nextRows);
  };

  const onCreateOrResendMagic = () => {
    const now = new Date().toISOString();
    const nextToken = magic?.token || makeToken();

    const nextMagic = {
      token: nextToken,
      active: true,
      sentAt: now,
      expiresAt: addHoursIso(72), // 3 days default
    };

    const nextProject = {
      ...(project || {}),
      projectId,
      magic: nextMagic,
      updatedAt: now,
    };

    updateEverywhere(nextProject, (r) => ({ ...r, magic: nextMagic, updatedAt: now }));

    const url = `${window.location.origin}${miniBase}/catalog?token=${encodeURIComponent(nextToken)}`;
    window.alert(`Magic link ready (same token reused if already active):\n${url}`);
  };

  const onExpireMagic = () => {
    const now = new Date().toISOString();

    const nextMagic = {
      ...(magic || {}),
      active: false,
      expiresAt: now,
    };

    const nextProject = {
      ...(project || {}),
      projectId,
      magic: nextMagic,
      updatedAt: now,
    };

    updateEverywhere(nextProject, (r) => ({ ...r, magic: nextMagic, updatedAt: now }));
  };

  if (!project && !row) {
    return (
      <div style={{ maxWidth: 1000 }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>Project not found</div>
        <div style={{ marginTop: 10 }}>
          <Link to="/projects">Back to Projects</Link>
        </div>
      </div>
    );
  }

  const displayName = project?.projectName || row?.projectName || "(Untitled)";
  const producer = project?.producer || row?.producer || "—";
  const company = project?.company || row?.company || "—";
  const date = project?.date || row?.date || "—";

  return (
    <div style={{ maxWidth: 1050 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a" }}>
            Project <span style={{ fontFamily: "monospace" }}>{projectId}</span> — {displayName}
          </div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
            Producer: <strong>{producer}</strong> • Company: <strong>{company}</strong> • Date: <strong>{date}</strong>
          </div>
          <div style={{ marginTop: 8 }}>
            <Link to="/projects" style={{ fontSize: 13 }}>
              ← Back to Projects
            </Link>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <a
            href={`${miniBase}/catalog${tokenQuery}`}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #111827",
              background: "#111827",
              color: "#fff",
              fontWeight: 900,
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Open Mini-site
          </a>
        </div>
      </div>

      {/* Master Save status */}
      <div style={panel()}>
        <div style={panelTitle()}>Master Save Status</div>

        <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Pill ok={!!master?.isMasterSaved} label={master?.isMasterSaved ? "Master Saved" : "Not Master Saved"} />
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            Saved at:{" "}
            <span style={{ fontFamily: "monospace", fontWeight: 900 }}>{master?.masterSavedAt || "—"}</span>
          </div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            Snapshot key:{" "}
            <span style={{ fontFamily: "monospace", fontWeight: 900 }}>{master?.lastSnapshotKey || "—"}</span>
          </div>
        </div>
      </div>

      {/* Magic link */}
      <div style={panel()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={panelTitle()}>Magic Link</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={onCreateOrResendMagic} style={primaryBtn()}>
              {magic?.token ? "Resend Magic Link" : "Create Magic Link"}
            </button>

            <button type="button" onClick={onExpireMagic} style={dangerBtn()} disabled={!magic?.token}>
              Expire
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
          Status:{" "}
          <strong style={{ color: magic?.active ? "#065f46" : "#9f1239" }}>
            {magic?.token ? (magic?.active ? "ACTIVE" : "INACTIVE") : "NONE"}
          </strong>
        </div>

        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
          Token: <span style={{ fontFamily: "monospace", fontWeight: 900 }}>{magic?.token || "—"}</span>
        </div>

        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
          Sent: <span style={{ fontFamily: "monospace", fontWeight: 900 }}>{magic?.sentAt || "—"}</span>
        </div>

        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
          Expires: <span style={{ fontFamily: "monospace", fontWeight: 900 }}>{magic?.expiresAt || "—"}</span>
        </div>

        <div style={{ marginTop: 12, fontSize: 13 }}>
          Mini-site link (Catalog):{" "}
          <a href={`${miniBase}/catalog${tokenQuery}`} style={{ fontFamily: "monospace" }}>
            {`${window.location.origin}${miniBase}/catalog${tokenQuery}`}
          </a>
        </div>
      </div>

      {/* Mini links */}
      <div style={panel()}>
        <div style={panelTitle()}>Mini-site Sections</div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {miniLinks.map((x) => (
            <a key={x.label} href={x.to} style={secondaryLink()}>
              {x.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function panel() {
  return {
    marginTop: 14,
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 14,
    background: "#fff",
  };
}
function panelTitle() {
  return { fontSize: 16, fontWeight: 900, color: "#0f172a" };
}
function Pill({ ok, label }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        background: ok ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.10)",
        color: ok ? "#065f46" : "#9f1239",
        fontWeight: 900,
        fontSize: 13,
      }}
    >
      {label}
    </div>
  );
}
function primaryBtn() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 13,
    whiteSpace: "nowrap",
  };
}
function dangerBtn() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #fecaca",
    background: "#fff",
    color: "#b91c1c",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 13,
    whiteSpace: "nowrap",
  };
}
function secondaryLink() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontWeight: 900,
    textDecoration: "none",
    fontSize: 13,
    whiteSpace: "nowrap",
  };
}
