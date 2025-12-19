import React from "react";
import { Outlet } from "react-router-dom";
import SideNav from "./SideNav.jsx";

export default function AppLayout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <SideNav />
      <div style={{ flex: 1, padding: 16 }}>
        <Outlet />
      </div>
    </div>
  );
}
