// src/minisite/album/albumStyles.js

import React from "react";

export function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
}

export function card() {
  return { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 };
}
export function subCard() {
  return { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 };
}
export function playerCard() {
  return { background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 14, padding: 12 };
}
export function sectionTitle() {
  return { fontSize: 12, fontWeight: 900, letterSpacing: 0.2, textTransform: "uppercase" };
}
export function input() {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontSize: 13,
    outline: "none",
  };
}
export function inputReadOnly() {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#f8fafc",
    fontSize: 13,
    outline: "none",
    color: "#111827",
    fontWeight: 900,
  };
}
export function primaryBtn() {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: "#111827",
    color: "#f9fafb",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
  };
}
export function primaryBtnSmall(enabled) {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "#f9fafb" : "#6b7280",
    fontSize: 12,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}
export function ghostBtn(disabled) {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: disabled ? "#f3f4f6" : "#fff",
    color: disabled ? "#9ca3af" : "#111827",
    fontSize: 13,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.8 : 1,
  };
}
export function ghostBtnSm(disabled) {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: disabled ? "#f3f4f6" : "#fff",
    color: disabled ? "#9ca3af" : "#111827",
    fontSize: 12,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.8 : 1,
  };
}
export function uploadBtn(disabled) {
  return {
    display: "inline-block",
    padding: "10px 14px",
    borderRadius: 12,
    background: disabled ? "#e5e7eb" : "#d1fae5",
    color: disabled ? "#6b7280" : "#065f46",
    fontSize: 12,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    border: disabled ? "1px solid #d1d5db" : "1px solid #a7f3d0",
    whiteSpace: "nowrap",
  };
}
export function lockBtn(locked) {
  const base = { padding: "8px 10px", borderRadius: 10, fontSize: 12, fontWeight: 900, cursor: "pointer" };
  if (!locked) return { ...base, border: "1px solid #a7f3d0", background: "#d1fae5", color: "#065f46" };
  return { ...base, border: "1px solid #fecaca", background: "#fee2e2", color: "#991b1b" };
}
export function rowPlayBtn(enabled) {
  return {
    width: 44,
    height: 34,
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "#f9fafb" : "#9ca3af",
    fontSize: 14,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}
export function dangerBtn() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #fecaca",
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
export function pillRed() {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    padding: "5px 10px",
    border: "1px solid #fecaca",
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  };
}
