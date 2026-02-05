// FILE: src/app/AppLayout.jsx
import React from "react";
import { Outlet } from "react-router-dom";

export default function AppLayout() {
  return (
    <div style={{ minHeight: "100vh", padding: 16 }}>
      <Outlet />
    </div>
  );
}
