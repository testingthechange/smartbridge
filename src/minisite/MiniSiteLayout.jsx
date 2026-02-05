// FILE: src/minisite/MiniSiteLayout.jsx
import React from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ProjectMiniSiteProvider } from "../ProjectMiniSiteContext.jsx";

import Catalog from "./Catalog.jsx";
import Songs from "./Songs.jsx";
import Meta from "./Meta.jsx";
import NFTMix from "./NFTMix.jsx";

function buildSearch(locationSearch, token, isAdmin) {
  const sp = new URLSearchParams(locationSearch || "");
  if (token) sp.set("token", token);
  else sp.delete("token");

  if (isAdmin) sp.set("admin", "1");
  else sp.delete("admin");

  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default function MiniSiteLayout() {
  const { projectId: projectIdParam, page } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const token = String(searchParams.get("token") || "").trim();
  const isAdmin = String(searchParams.get("admin") || "").trim() === "1";
  const isProducerView = Boolean(token) && !isAdmin;

  const pid = String(projectIdParam ?? "").trim();
  if (!pid) return <Navigate to="/admin/send" replace />;

  const p0 = String(page || "").toLowerCase();
  const pageMap = {
    catalog: "catalog",
    songs: "songs",
    meta: "meta",
    "nft-mix": "nft-mix",
    nftmix: "nft-mix",
  };
  const p = pageMap[p0] || "";

  const search = buildSearch(location.search, token, isAdmin);

  if (!p) return <Navigate to={`/minisite/${encodeURIComponent(pid)}/catalog${search}`} replace />;

  const tabs = [
    { key: "catalog", label: "Catalog" },
    { key: "songs", label: "Songs" },
    { key: "meta", label: "Meta" },
    { key: "nft-mix", label: "NFT Mix" },
  ];

  return (
    <ProjectMiniSiteProvider projectId={pid}>
      <div style={{ minHeight: "100vh", background: "#ffffff", color: "#111" }}>
        <div
          style={{
            borderBottom: "1px solid rgba(0,0,0,0.12)",
            background: "#ffffff",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <div
            style={{
              maxWidth: 1120,
              margin: "0 auto",
              padding: "12px 16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontWeight: 800, letterSpacing: 0.2 }}>EXECUTIVE PRODUCTION SUITE</div>
              <div style={{ fontSize: 11, opacity: 0.75 }}>
                Project: <b>{pid}</b>
                {!isProducerView ? (
                  <>
                    {" "}
                    • Token: <span style={{ fontFamily: "monospace" }}>{token || "—"}</span>
                    {isAdmin ? <span style={{ marginLeft: 8 }}>(admin)</span> : null}
                  </>
                ) : null}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {tabs.map((t) => {
                const active = t.key === p;
                return (
                  <Link
                    key={t.key}
                    to={`/minisite/${encodeURIComponent(pid)}/${t.key}${search}`}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 12,
                      border: active ? "1px solid rgba(26,115,232,0.45)" : "1px solid rgba(0,0,0,0.18)",
                      background: active ? "rgba(26,115,232,0.10)" : "#ffffff",
                      textDecoration: "none",
                      color: "#111",
                      fontSize: 13,
                      fontWeight: active ? 700 : 600,
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
          {p === "songs" ? <Songs /> : null}
          {p === "meta" ? <Meta /> : null}
          {p === "nft-mix" ? <NFTMix /> : null}
        </div>
      </div>
    </ProjectMiniSiteProvider>
  );
}
