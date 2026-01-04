// src/pages/Projects.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

/**
 * Producer-scoped Projects list
 *
 * Storage:
 * - sb:projects_index:<producerId> = array of rows for that producer only
 * - project_<projectId> = per-project working state (Catalog/Album/etc)
 */

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

function indexKey(producerId) {
  return `sb:projects_index:${String(producerId || "no-producer")}`;
}

function generate6DigitId(existingIdsSet) {
  for (let i = 0; i < 50; i++) {
    const n = Math.floor(Math.random() * 900000) + 100000;
    const id = String(n);
    if (!existingIdsSet.has(id)) return id;
  }
  return String(Date.now()).slice(-6);
}

function loadProjectsIndex(producerId) {
  const raw = localStorage.getItem(indexKey(producerId));
  const parsed = raw ? safeParse(raw) : null;
  return Array.isArray(parsed) ? parsed : [];
}

function saveProjectsIndex(producerId, rows) {
  localStorage.setItem(
    indexKey(producerId),
    JSON.stringify(Array.isArray(rows) ? rows : [])
  );
}

function hasAnyPublish(p) {
  if (!p) return false;
  return (
    !!safeString(p.lastShareId) ||
    !!safeString(p.lastPublicUrl) ||
    !!safeString(p.manifestKey) ||
    !!safeString(p.publishedAt) ||
    !!safeString(p.snapshotKey)
  );
}

function isPublishComplete(p) {
  // ✅ stricter: only show Published when we have a real publish result
  const lastShareId = safeString(p?.lastShareId);
  const lastPublicUrl = safeString(p?.lastPublicUrl);
  const manifestKey = safeString(p?.manifestKey);
  const publishedAt = safeString(p?.publishedAt);

  return !!lastShareId && !!lastPublicUrl && !!manifestKey && !!publishedAt;
}

/**
 * Derive status from the project_{id} blob.
 * This avoids needing Project page to update the index row.
 */
function deriveStatusFromProjectBlob(projectId) {
  const raw = localStorage.getItem(projectKey(projectId));
  const p = raw ? safeParse(raw) : null;

  if (!p || typeof p !== "object") {
    return {
      isMasterSaved: false,
      masterSavedAt: "",
      producerReturnReceived: false,
      producerReturnReceivedAt: "",
      lastSnapshotKey: "",
      publish: {
        lastShareId: "",
        lastPublicUrl: "",
        publishedAt: "",
        manifestKey: "",
        snapshotKey: "",
      },
      hasProjectBlob: false,
    };
  }

  // Legacy-ish fields
  const catalogSavedAt = safeString(p?.catalog?.masterSave?.savedAt);
  const catalogS3Path = safeString(p?.catalog?.masterSave?.s3Path);

  // Unified master-save model
  const unifiedSavedAt = safeString(p?.masterSave?.lastMasterSaveAt || "");
  const unifiedCatalogComplete = !!p?.masterSave?.sections?.catalog?.complete;

  const isMasterSaved = !!catalogSavedAt || !!unifiedSavedAt || !!unifiedCatalogComplete;
  const masterSavedAt =
    catalogSavedAt ||
    unifiedSavedAt ||
    safeString(p?.masterSave?.sections?.catalog?.masterSavedAt);

  const producerReturnReceived =
    !!p?.master?.producerReturnReceived || !!p?.masterSave?.producerReturnReceived;

  const producerReturnReceivedAt =
    safeString(p?.master?.producerReturnReceivedAt) ||
    safeString(p?.masterSave?.producerReturnReceivedAt);

  // Snapshot key (prefer unified publish.snapshotKey if present, else legacy lastSnapshotKey/s3Path)
  const lastSnapshotKey =
    safeString(p?.publish?.snapshotKey) ||
    catalogS3Path ||
    safeString(p?.master?.lastSnapshotKey) ||
    "";

  const publish = {
    lastShareId: safeString(p?.publish?.lastShareId),
    lastPublicUrl: safeString(p?.publish?.lastPublicUrl),
    publishedAt: safeString(p?.publish?.publishedAt),
    manifestKey: safeString(p?.publish?.manifestKey),
    snapshotKey: safeString(p?.publish?.snapshotKey),
  };

  return {
    isMasterSaved,
    masterSavedAt,
    producerReturnReceived,
    producerReturnReceivedAt,
    lastSnapshotKey,
    publish,
    hasProjectBlob: true,
  };
}

function Badge({ ok, label, title }) {
  return (
    <span
      title={title || ""}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 950,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #d1d5db",
        background: ok ? "rgba(16,185,129,0.12)" : "#f8fafc",
        color: ok ? "#065f46" : "#111827",
      }}
    >
      {ok ? "✅" : "—"} {label}
    </span>
  );
}

export default function Projects() {
  const { producerId } = useParams();

  const [rows, setRows] = useState(() => loadProjectsIndex(producerId));
  const [form, setForm] = useState({ projectName: "", date: "", company: "" });

  // Persist rows (producer-scoped)
  useEffect(() => {
    saveProjectsIndex(producerId, rows);
  }, [rows, producerId]);

  const existingIds = useMemo(
    () => new Set((rows || []).map((r) => String(r.projectId))),
    [rows]
  );

  // Re-derive status from project_{id} whenever we land here or list length changes
  useEffect(() => {
    if (!producerId) return;

    setRows((prev) =>
      (prev || []).map((r) => {
        const derived = deriveStatusFromProjectBlob(r.projectId);

        // Master/Return always derive from project blob when present
        const nextMaster = {
          ...(r.master || {}),
          isMasterSaved: !!derived.isMasterSaved,
          masterSavedAt: safeString(derived.masterSavedAt) || "",
          lastSnapshotKey: safeString(derived.lastSnapshotKey) || "",
          producerReturnReceived: !!derived.producerReturnReceived,
          producerReturnReceivedAt: safeString(derived.producerReturnReceivedAt) || "",
        };

        // Publish: prefer project blob if it has ANY publish fields; otherwise keep index row
        const derivedPublish = derived.publish || {};
        const nextPublish = hasAnyPublish(derivedPublish)
          ? {
              lastShareId: safeString(derivedPublish.lastShareId),
              lastPublicUrl: safeString(derivedPublish.lastPublicUrl),
              publishedAt: safeString(derivedPublish.publishedAt),
              manifestKey: safeString(derivedPublish.manifestKey),
              snapshotKey: safeString(derivedPublish.snapshotKey),
            }
          : {
              ...(r.publish || {}),
              lastShareId: safeString(r?.publish?.lastShareId),
              lastPublicUrl: safeString(r?.publish?.lastPublicUrl),
              publishedAt: safeString(r?.publish?.publishedAt),
              manifestKey: safeString(r?.publish?.manifestKey),
              snapshotKey: safeString(r?.publish?.snapshotKey),
            };

        return { ...r, master: nextMaster, publish: nextPublish };
      })
    );
  }, [producerId, rows?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCreate = () => {
    const projectName = safeString(form.projectName);
    if (!projectName) {
      window.alert("Project Name required.");
      return;
    }
    if (!producerId) {
      window.alert("Missing producerId in route.");
      return;
    }

    const projectId = generate6DigitId(existingIds);
    const nowIso = new Date().toISOString();

    const newRow = {
      projectId,
      projectName,
      date: safeString(form.date),
      producerId: safeString(producerId),
      company: safeString(form.company),
      createdAt: nowIso,
      updatedAt: nowIso,
      magic: { token: "", active: false, expiresAt: "", sentAt: "" },
      master: {
        isMasterSaved: false,
        masterSavedAt: "",
        lastSnapshotKey: "",
        producerReturnReceived: false,
        producerReturnReceivedAt: "",
      },
      publish: {
        lastShareId: "",
        lastPublicUrl: "",
        publishedAt: "",
        manifestKey: "",
        snapshotKey: "",
      },
    };

    const seed = {
      projectId,
      projectName,
      producerId: newRow.producerId,
      company: newRow.company,
      date: newRow.date,
      createdAt: nowIso,
      updatedAt: nowIso,
      catalog: { songs: [] },
      album: { meta: {} },
      nftMix: {},
      songs: {},
      meta: { songs: [] },
      magic: newRow.magic,
      master: newRow.master,
      publish: newRow.publish,
    };
    localStorage.setItem(projectKey(projectId), JSON.stringify(seed));

    setRows((prev) => [newRow, ...(prev || [])]);
    setForm({ projectName: "", date: "", company: "" });
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ fontSize: 26, fontWeight: 900, color: "#0f172a" }}>
        Projects
      </div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
        Producer:{" "}
        <span style={{ fontFamily: "monospace", fontWeight: 900 }}>
          {producerId}
        </span>
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
        <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
          Create Project
        </div>

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
            type="date"
            value={form.date}
            onChange={(v) => setForm((p) => ({ ...p, date: v }))}
          />

          <Field
            label="Company"
            value={form.company}
            onChange={(v) => setForm((p) => ({ ...p, company: v }))}
            placeholder="Company / label"
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 900,
                opacity: 0.7,
                textTransform: "uppercase",
              }}
            >
              Producer ID
            </div>
            <input
              value={safeString(producerId)}
              readOnly
              style={{
                padding: "12px 12px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                fontSize: 15,
                outline: "none",
                background: "#f8fafc",
                fontFamily: "monospace",
                fontWeight: 900,
                color: "#0f172a",
              }}
            />
          </div>
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
        <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
          Project List
        </div>

        <div
          style={{
            marginTop: 10,
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              padding: 12,
              background: "#f8fafc",
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <div style={{ width: 110, fontWeight: 900, fontSize: 12, opacity: 0.7 }}>
              Project ID
            </div>
            <div style={{ flex: 1, fontWeight: 900, fontSize: 12, opacity: 0.7 }}>
              Project
            </div>
            <div style={{ width: 170, fontWeight: 900, fontSize: 12, opacity: 0.7 }}>
              Company
            </div>
            <div style={{ width: 360, fontWeight: 900, fontSize: 12, opacity: 0.7 }}>
              Status
            </div>
          </div>

          {(rows || []).map((r) => {
            const isMasterSaved = !!r?.master?.isMasterSaved;
            const returnReceived = !!r?.master?.producerReturnReceived;
            const published = isPublishComplete(r?.publish);

            return (
              <div
                key={r.projectId}
                style={{
                  display: "flex",
                  padding: 12,
                  borderBottom: "1px solid #eef2f7",
                  background: "#fff",
                  alignItems: "center",
                }}
              >
                <div style={{ width: 110, fontFamily: "monospace", fontWeight: 900 }}>
                  <Link
                    to={`/projects/${r.projectId}`}
                    style={{ textDecoration: "none", color: "#111827" }}
                    title="Open project"
                  >
                    {r.projectId}
                  </Link>
                </div>

                <div style={{ flex: 1, fontWeight: 800, color: "#0f172a" }}>
                  {r.projectName}
                </div>

                <div style={{ width: 170, opacity: 0.85 }}>
                  {r.company || "—"}
                </div>

                <div
                  style={{
                    width: 360,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <Badge
                    ok={isMasterSaved}
                    label="Master"
                    title={r?.master?.masterSavedAt ? `Master saved at ${r.master.masterSavedAt}` : ""}
                  />
                  <Badge
                    ok={returnReceived}
                    label="Return"
                    title={
                      r?.master?.producerReturnReceivedAt
                        ? `Return received at ${r.master.producerReturnReceivedAt}`
                        : ""
                    }
                  />

                  {published ? (
                    <a
                      href={safeString(r?.publish?.lastPublicUrl)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "none" }}
                      title="Open published mini-site"
                    >
                      <Badge ok={true} label="Published" />
                    </a>
                  ) : (
                    <Badge ok={false} label="Published" />
                  )}
                </div>
              </div>
            );
          })}

          {!rows?.length ? (
            <div style={{ padding: 12, background: "#fff" }}>No projects yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({ label, type = "text", value, onChange, placeholder }) {
  const isDate = type === "date";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7, textTransform: "uppercase" }}>
        {label}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isDate ? undefined : placeholder}
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
