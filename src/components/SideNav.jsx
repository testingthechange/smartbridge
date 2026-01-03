// src/components/SideNav.jsx
import React, { useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";

const linkStyle = ({ isActive }) => ({
  display: "block",
  padding: "10px 12px",
  borderRadius: 8,
  fontSize: 13,
  textDecoration: "none",
  color: isActive ? "#111827" : "#374151",
  background: isActive ? "#e5e7eb" : "transparent",
});

function getActiveProjectIdFromPath(pathname) {
  // Only infer projectId from minisite routes
  const p = String(pathname || "");
  const m = p.match(/^\/minisite\/([^/]+)\//);
  if (m?.[1]) return m[1];
  return null;
}

export default function SideNav() {
  const { pathname, search } = useLocation();
  const currentId = useMemo(() => getActiveProjectIdFromPath(pathname), [pathname]);

  // Preserve querystring between minisite pages (token, etc.)
  const qs = search || "?token=demo";
  const minisiteId = currentId || "demo";

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: "1px solid #e5e7eb",
        background: "#ffffff",
        padding: 16,
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>INTERNAL</div>

      <NavLink to="/producer" style={linkStyle}>
        Producer
      </NavLink>

      {/* Projects + Project links removed for rollout stability */}

      <NavLink to="/admin" style={linkStyle}>
        Admin
      </NavLink>

      <NavLink to="/export-tools" style={linkStyle}>
        Export / Tools
      </NavLink>

      <div style={{ fontSize: 11, opacity: 0.6, margin: "16px 0 8px" }}>
        MINI SITE ({minisiteId})
      </div>

      <NavLink to={`/minisite/${minisiteId}/catalog${qs}`} style={linkStyle}>
        Catalog
      </NavLink>

      <NavLink to={`/minisite/${minisiteId}/album${qs}`} style={linkStyle}>
        Album
      </NavLink>

      <NavLink to={`/minisite/${minisiteId}/nft-mix${qs}`} style={linkStyle}>
        NFT Mix
      </NavLink>

      <NavLink to={`/minisite/${minisiteId}/songs${qs}`} style={linkStyle}>
        Songs
      </NavLink>

      <NavLink to={`/minisite/${minisiteId}/meta${qs}`} style={linkStyle}>
        Meta
      </NavLink>
    </aside>
  );
}
