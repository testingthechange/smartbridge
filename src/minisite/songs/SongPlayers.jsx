import React from "react";

export default function SongPlayers({
  fromLabel,
  toLabel,
  bridgeUrl,
  aFromUrl,
  toUrl,
  bridgePlayer,
  abcPlayer,
}) {
  return (
    <div
      style={{
        marginTop: 14,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 14,
      }}
    >
      <div style={card()}>
        <div style={sectionTitle()}>Bridge Preview</div>
        <div style={{ marginTop: 10 }}>{bridgePlayer}</div>
      </div>

      <div style={card()}>
        <div style={sectionTitle()}>A + Bridge + To Preview</div>
        <div style={{ marginTop: 10 }}>{abcPlayer}</div>
      </div>
    </div>
  );
}

function card() {
  return {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 16,
  };
}

function sectionTitle() {
  return {
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    opacity: 0.75,
  };
}
