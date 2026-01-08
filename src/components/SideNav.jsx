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
  const m = String(pathname || "").match(/^\/minisite\/([^/]+)(\/|$)/);
  return m?.[1] || null;
}

export default function SideNav() {
  const { pathname, search } = useLocation();

  const projectId = useMemo(
    () => getActiveProjectIdFromPath(pathname),
    [pathname]
  );

  const qs = search || "";

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
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>
        INTERNAL
      </div>

      <NavLink to="/producer" style={linkStyle}>
        Producer
      </NavLink>

      <NavLink to="/admin" style={linkStyle}>
        Admin
      </NavLink>

      <NavLink to="/export-tools" style={linkStyle}>
        Export / Tools
      </NavLink>

      <div style={{ fontSize: 11, opacity: 0.6, margin: "16px 0 8px" }}>
        MINI SITE
      </div>

      {!projectId ? (
        <div style={{ fontSize: 12, opacity: 0.5 }}>
          Select a project to enable mini-site
        </div>
      ) : (
        <>
          <NavLink to={`/minisite/${projectId}/catalog${qs}`} style={linkStyle}>
            Catalog
          </NavLink>

          <NavLink to={`/minisite/${projectId}/album${qs}`} style={linkStyle}>
            Album
          </NavLink>

          <NavLink to={`/minisite/${projectId}/nft-mix${qs}`} style={linkStyle}>
            NFT Mix
          </NavLink>

          <NavLink to={`/minisite/${projectId}/songs${qs}`} style={linkStyle}>
            Songs
          </NavLink>

          <NavLink to={`/minisite/${projectId}/meta${qs}`} style={linkStyle}>
            Meta
          </NavLink>
        </>
      )}
    </aside>
  );
}
