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
  // /minisite/:projectId/... OR /projects/:projectId
  const p = String(pathname || "");

  const m1 = p.match(/^\/minisite\/([^/]+)\//);
  if (m1?.[1]) return m1[1];

  const m2 = p.match(/^\/projects\/([^/]+)$/);
  if (m2?.[1]) return m2[1];

  return null;
}

export default function SideNav() {
  const { pathname, search } = useLocation();

  const currentId = useMemo(() => getActiveProjectIdFromPath(pathname), [pathname]);

  // Preserve querystring between minisite pages (token, etc.)
  const qs = search || "?token=demo";

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

      <NavLink to="/projects" style={linkStyle}>
        Projects
      </NavLink>

      {/* Only show if we can infer a project id from URL */}
      {currentId ? (
        <NavLink to={`/projects/${currentId}`} style={linkStyle}>
          Project ({currentId})
        </NavLink>
      ) : null}

      <NavLink to="/admin" style={linkStyle}>
        Admin
      </NavLink>

      <NavLink to="/export-tools" style={linkStyle}>
        Export / Tools
      </NavLink>

      <div style={{ fontSize: 11, opacity: 0.6, margin: "16px 0 8px" }}>
        MINI SITE ({currentId || "demo"})
      </div>

      <NavLink to={`/minisite/${currentId || "demo"}/catalog${qs}`} style={linkStyle}>
        Catalog
      </NavLink>

      <NavLink to={`/minisite/${currentId || "demo"}/album${qs}`} style={linkStyle}>
        Album
      </NavLink>

      <NavLink to={`/minisite/${currentId || "demo"}/nft-mix${qs}`} style={linkStyle}>
        NFT Mix
      </NavLink>

      <NavLink to={`/minisite/${currentId || "demo"}/songs${qs}`} style={linkStyle}>
        Songs
      </NavLink>

      <NavLink to={`/minisite/${currentId || "demo"}/meta${qs}`} style={linkStyle}>
        Meta
      </NavLink>
    </aside>
  );
}
