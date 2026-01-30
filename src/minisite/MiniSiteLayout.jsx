// FILE: src/minisite/MiniSiteLayout.jsx
import React from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";

import { ProjectMiniSiteProvider } from "../ProjectMiniSiteContext.jsx";
import Catalog from "./catalog/Catalog.jsx";

function ComingSoon({ title }) {
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "16px 0" }}>
      <h2 style={{ marginTop: 10 }}>{title}</h2>
      <div style={{ opacity: 0.75, fontSize: 13 }}>Not wired yet.</div>
    </div>
  );
}

export default function MiniSiteLayout() {
  const { projectId: projectIdParam, page } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const token = String(searchParams.get("token") || "").trim();
  const isAdmin = String(searchParams.get("admin") || "").trim() === "1";

  // Producer view = token present AND not admin preview
  const isProducerView = Boolean(token) && !isAdmin;

  const pid = String(projectIdParam || "demo");
  const search = location.search || "";

  const p = String(page || "catalog").toLowerCase();
  const allowed = new Set(["catalog", "album", "nftmix", "songs", "meta"]);
  if (!allowed.has(p)) {
    return <Navigate to={`/minisite/${encodeURIComponent(pid)}/catalog${search}`} replace />;
  }

  const tabs = [
    { key: "catalog", label: "Catalog" },
    { key: "album", label: "Album" },
    { key: "nftmix", label: "NFT Mix" },
    { key: "songs", label: "Songs" },
    { key: "meta", label: "Meta" },
  ];

  return (
    <ProjectMiniSiteProvider projectId={pid}>
      <div style={{ minHeight: "100vh" }}>
        {/* Producer-safe small header; no internal/admin nav in producer view */}
        <div
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(16,24,36,0.85)",
            position: "sticky",
            top: 0,
            zIndex: 10,
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            style={{
              maxWidth: 1120,
              margin: "0 auto",
              padding: "10px 16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              Project: <b>{pid}</b>
              {!isProducerView ? (
                <>
                  {" "}
                  • Token:{" "}
                  <span style={{ fontFamily: "monospace" }}>{token || "—"}</span>{" "}
                  {isAdmin ? <span style={{ marginLeft: 8 }}>(admin)</span> : null}
                </>
              ) : null}
            </div>

            {/* Minisite tabs (safe for producer view) */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {tabs.map((t) => {
                const active = t.key === p;
                return (
                  <Link
                    key={t.key}
                    to={`/minisite/${encodeURIComponent(pid)}/${t.key}${search}`}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: active
                        ? "1px solid rgba(90,167,255,0.35)"
                        : "1px solid rgba(255,255,255,0.12)",
                      background: active ? "rgba(90,167,255,0.16)" : "rgba(255,255,255,0.05)",
                      textDecoration: "none",
                      color: "inherit",
                      fontSize: 13,
                    }}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 16px" }}>
          {p === "catalog" ? <Catalog /> : null}
          {p === "album" ? <ComingSoon title="Album" /> : null}
          {p === "nftmix" ? <ComingSoon title="NFT Mix" /> : null}
          {p === "songs" ? <ComingSoon title="Songs" /> : null}
          {p === "meta" ? <ComingSoon title="Meta" /> : null}
        </div>
      </div>
    </ProjectMiniSiteProvider>
  );
}
