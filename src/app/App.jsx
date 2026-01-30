// FILE: src/app/App.jsx
import React from "react";
import AppRoutes from "./routes.jsx";

export default function App() {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ border: "3px solid lime", padding: 10, marginBottom: 12 }}>
        APP ROOT IS RENDERING
      </div>
      <AppRoutes />
    </div>
  );
}
