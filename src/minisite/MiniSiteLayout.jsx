// FILE: src/minisite/MiniSiteLayout.jsx
import React from "react";
import { useLocation, useParams } from "react-router-dom";

import Catalog from "./catalog/Catalog.jsx";

export default function MiniSiteLayout() {
  const { projectId, page } = useParams();
  const location = useLocation();
  const p = String(page || "catalog").toLowerCase();

  return (
    <div style={{ padding: 16 }}>
      <div style={{ border: "3px solid red", padding: 10, marginBottom: 12 }}>
        MINISITE LAYOUT IS RENDERING — projectId={String(projectId)} page={String(page)} search={location.search}
      </div>

      {p === "catalog" ? <Catalog /> : <div>Page not wired: {p}</div>}
    </div>
  );
}
