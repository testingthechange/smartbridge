// src/components/SideNav.jsx
import React, { useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";

export default function SideNav() {
  const location = useLocation();

  const { isProducerView } = useMemo(() => {
    const sp = new URLSearchParams(location.search || "");
    const token = (sp.get("token") || "").trim();
    const isAdmin = (sp.get("admin") || "").trim() === "1";
    return { isProducerView: !!token && !isAdmin };
  }, [location.search]);

  const linkStyle = ({ isActive }) => ({
    display: "block",
    padding: "10px 12px",
    borderRadius: 12,
    textDecoration: "none",
    color: "#0f172a",
    fontWeight: 800,
    background: isActive ? "rgba(15, 23, 42, 0.06)" : "transparent",
  });

  const sectionStyle = {
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.65,
    letterSpacing: 0.02,
    marginTop: 14,
    marginBottom: 8,
  };

  return (
    <div style={{ width: 260, padding: 16 }}>
      {/* INTERNAL NAV: never show in producer magic-link view */}
      {!isProducerView ? (
        <>
          <div style={sectionStyle}>INTERNAL</div>

          <NavLink to="/producer" style={linkStyle}>
            Producer
          </NavLink>

          <NavLink to="/admin" style={linkStyle}>
            Admin
          </NavLink>

          <NavLink to="/export" style={linkStyle}>
            Export / Tools
          </NavLink>
        </>
      ) : null}

      {/* MINI SITE NAV: always show */}
      <div style={sectionStyle}>MINI SITE</div>

      <NavLink to={withSameQuery("/minisite/:projectId/catalog", location)} style={linkStyle}>
        Catalog
      </NavLink>
      <NavLink to={withSameQuery("/minisite/:projectId/album", location)} style={linkStyle}>
        Album
      </NavLink>
      <NavLink to={withSameQuery("/minisite/:projectId/nft-mix", location)} style={linkStyle}>
        NFT Mix
      </NavLink>
      <NavLink to={withSameQuery("/minisite/:projectId/songs", location)} style={linkStyle}>
        Songs
      </NavLink>
      <NavLink to={withSameQuery("/minisite/:projectId/meta", location)} style={linkStyle}>
        Meta
      </NavLink>
    </div>
  );
}

/**
 * Preserve token/admin query while swapping path.
 * Assumes current pathname includes /minisite/<projectId>/...
 */
function withSameQuery(templatePath, location) {
  const parts = (location.pathname || "").split("/").filter(Boolean);
  const minisiteIdx = parts.indexOf("minisite");
  const projectId = minisiteIdx >= 0 ? parts[minisiteIdx + 1] : "";
  const path = templatePath.replace(":projectId", projectId || "");
  return `${path}${location.search || ""}`;
}
