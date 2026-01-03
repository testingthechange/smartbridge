// src/minisite/songs/components/ConnectionsWorksheet.jsx
import React, { useEffect, useRef, useState } from "react";

export default function ConnectionsWorksheet({
  fromSlots = [1, 2, 3],
  connections = [],

  // IMPORTANT: in your current Songs.jsx these are keyed by toSlot (string)
  lockMap = {}, // { [toSlot]: boolean }
  toListenChoice = {}, // { [toSlot]: "A"|"B" }

  songTitle,
  songAUrl,
  songBUrl,

  // In your current Songs.jsx: handlePickBridge(toSlot, file)
  // If you later switch to (fromSlot, toSlot, file), update the call below.
  handlePickBridge,

  // In your current Songs.jsx: toggleLock(toSlot)
  toggleLock,

  // In your current Songs.jsx: setChoice(toSlot, "A"|"B")
  setChoice,

  // In your current Songs.jsx: requestBridgePlay(toSlot)
  // If you later switch to (fromSlot, toSlot), update the call below.
  requestBridgePlay,

  // expects the same key format as connections.key (e.g. "1->2")
  bridgePlayingKey = "",
  bridgeIsPlaying = false,
  setBridgePlayingKey,

  setActiveToSlot,
  activeToSlot,

  card,
  sectionTitle,
}) {
  return (
    <div style={{ marginTop: 14, ...(card ? card() : fallbackCard) }}>
      <div style={sectionTitle ? sectionTitle() : fallbackSectionTitle}>Connections</div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
        Each “worksheet” is a FROM song connecting to all other songs. Dome-lock freezes bridge + To choice.
      </div>

      {fromSlots.map((fromSlot) => {
        const rows = connections.filter((r) => Number(r.fromSlot) === Number(fromSlot));

        return (
          <div key={`ws-${fromSlot}`} style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <div style={{ fontSize: 13, fontWeight: 950, color: "#0f172a" }}>
                Worksheet: <span style={{ opacity: 0.7 }}>From</span> Song {fromSlot} —{" "}
                {typeof songTitle === "function" ? songTitle(fromSlot) : `Song ${fromSlot}`}
              </div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{rows.length} connections</div>
            </div>

            <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
              {/* header row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1.8fr 1.6fr 120px",
                  gap: 10,
                  padding: "10px 12px",
                  background: "#f8fafc",
                  borderBottom: "1px solid #e5e7eb",
                  fontSize: 11,
                  fontWeight: 900,
                  opacity: 0.75,
                  textTransform: "uppercase",
                  letterSpacing: 0.2,
                  alignItems: "center",
                }}
              >
                <div>From</div>
                <div style={{ textAlign: "center" }}>+ Bridge +</div>
                <div>To</div>
                <div style={{ textAlign: "right" }}>Dome</div>
              </div>

              {rows.map((row, idx) => {
                const toSlotNum = Number(row.toSlot);
                const toK = String(toSlotNum);

                // Use the single source of truth: toSlot-keyed maps
                const locked = !!lockMap?.[toK];

                const savedChoiceRaw = String(toListenChoice?.[toK] ?? "A").toUpperCase();
                const choice = savedChoiceRaw === "B" ? "B" : "A";

                const toA = typeof songAUrl === "function" ? songAUrl(toSlotNum) : "";
                const toB = typeof songBUrl === "function" ? songBUrl(toSlotNum) : "";
                const listenUrl = choice === "B" ? toB : toA;

                const pairKey = String(row.key || `${fromSlot}->${toSlotNum}`); // used only for play identity
                const rowIsCurrent = bridgePlayingKey === pairKey;
                const isActive = Number(activeToSlot) === toSlotNum;

                return (
                  <div
                    key={pairKey}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.4fr 1.8fr 1.6fr 120px",
                      gap: 10,
                      padding: "12px 12px",
                      borderBottom: idx === rows.length - 1 ? "none" : "1px solid #e5e7eb",
                      background: isActive ? "rgba(16,185,129,0.06)" : "#fff",
                      alignItems: "center",
                    }}
                  >
                    {/* FROM */}
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 950,
                          color: "#0f172a",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        Song {fromSlot} — {typeof songTitle === "function" ? songTitle(fromSlot) : `Song ${fromSlot}`}
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          fontSize: 12,
                          opacity: 0.8,
                        }}
                      >
                        <span style={pill()}>A</span>
                        <span style={{ fontSize: 12, opacity: 0.75 }}>From uses A in preview.</span>
                      </div>
                    </div>

                    {/* BRIDGE */}
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", maxWidth: 520 }}>
                        <button
                          type="button"
                          disabled={!row.bridgeUrl}
                          title={row.bridgeUrl ? "Play/Pause bridge in Bridge Preview player" : "Upload bridge first"}
                          onClick={() => {
                            if (!row.bridgeUrl) return;

                            // If THIS row is currently playing -> pause by clearing key
                            if (rowIsCurrent && bridgeIsPlaying) {
                              setBridgePlayingKey?.("");
                              return;
                            }

                            // make this row active in the TOP players
                            setActiveToSlot?.(toSlotNum);

                            // your current Songs.jsx signature: requestBridgePlay(toSlot)
                            requestBridgePlay?.(toSlotNum);

                            // keep identity consistent with row key ("1->2")
                            setBridgePlayingKey?.(pairKey);
                          }}
                          style={circleBtn(!!row.bridgeUrl, isActive)}
                        >
                          {rowIsCurrent && bridgeIsPlaying ? "⏸" : "▶"}
                        </button>

                        <label style={uploadBtn(locked)}>
                          Upload
                          <input
                            type="file"
                            accept="audio/*"
                            disabled={locked}
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              // current Songs.jsx signature: handlePickBridge(toSlot, file)
                              handlePickBridge?.(toSlotNum, f);

                              // if you switch to: handlePickBridge(fromSlot, toSlot, file)
                              // handlePickBridge?.(fromSlot, toSlotNum, f);

                              e.target.value = "";
                            }}
                          />
                        </label>

                        <div style={{ minWidth: 0, flex: 1, fontSize: 12, opacity: 0.75 }}>
                          {row.bridgeFileName ? (
                            <code style={{ wordBreak: "break-word" }}>{row.bridgeFileName}</code>
                          ) : (
                            "—"
                          )}
                          {locked ? (
                            <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 900, opacity: 0.6 }}>LOCKED</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* TO */}
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 950,
                          color: "#0f172a",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        Song {toSlotNum} — {typeof songTitle === "function" ? songTitle(toSlotNum) : `Song ${toSlotNum}`}
                      </div>

                      <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <label style={radioPill(choice === "A", !!toA && !locked)} title={toA ? "Use A" : "Missing A file"}>
                          <input
                            type="radio"
                            name={`to-${pairKey}`}
                            checked={choice === "A"}
                            onChange={() => setChoice?.(toSlotNum, "A")}
                            disabled={!toA || locked}
                            style={{ marginRight: 6 }}
                          />
                          Listen to A
                        </label>

                        <label style={radioPill(choice === "B", !!toB && !locked)} title={toB ? "Use B" : "Missing B file"}>
                          <input
                            type="radio"
                            name={`to-${pairKey}`}
                            checked={choice === "B"}
                            onChange={() => setChoice?.(toSlotNum, "B")}
                            disabled={!toB || locked}
                            style={{ marginRight: 6 }}
                          />
                          Listen to B
                        </label>

                        <MiniInlinePlayer url={listenUrl} disabled={!listenUrl} label={`To ${choice}`} />
                      </div>
                    </div>

                    {/* DOME LOCK */}
                    <div style={{ justifySelf: "end" }}>
                      <button type="button" onClick={() => toggleLock?.(toSlotNum)} style={lockBtn(locked)}>
                        {locked ? "Locked" : "Unlock"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- tiny inline To preview ---------------- */

function MiniInlinePlayer({ url, disabled, label }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setIsPlaying(false);
    const el = audioRef.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
    } catch {}
  }, [url]);

  const toggle = async () => {
    if (disabled) return;
    const el = audioRef.current;
    if (!el) return;

    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await el.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" onClick={toggle} disabled={disabled} style={tinyBtn(!disabled)} title={label}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <audio ref={audioRef} src={url || undefined} onEnded={() => setIsPlaying(false)} />
    </div>
  );
}

/* ---------------- styles (local) ---------------- */

const fallbackCard = { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 };
const fallbackSectionTitle = { fontSize: 12, fontWeight: 900, letterSpacing: 0.2, textTransform: "uppercase" };

function pill() {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    padding: "4px 10px",
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.85,
  };
}

function uploadBtn(locked) {
  return {
    display: "inline-block",
    padding: "8px 12px",
    borderRadius: 10,
    background: locked ? "#e5e7eb" : "#d1fae5",
    color: locked ? "#6b7280" : "#065f46",
    fontSize: 12,
    fontWeight: 900,
    cursor: locked ? "not-allowed" : "pointer",
    border: locked ? "1px solid #d1d5db" : "1px solid #a7f3d0",
    whiteSpace: "nowrap",
  };
}

function lockBtn(locked) {
  const base = { padding: "8px 10px", borderRadius: 10, fontSize: 12, fontWeight: 900, cursor: "pointer" };
  if (!locked) return { ...base, border: "1px solid #a7f3d0", background: "#d1fae5", color: "#065f46" };
  return { ...base, border: "1px solid #fecaca", background: "#fee2e2", color: "#991b1b" };
}

function tinyBtn(enabled) {
  return {
    padding: "6px 8px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "#f9fafb" : "#6b7280",
    fontSize: 11,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}

function radioPill(active, enabled) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: active ? "1px solid rgba(15,23,42,0.55)" : "1px solid #e5e7eb",
    background: !enabled ? "#f3f4f6" : active ? "rgba(15,23,42,0.05)" : "#fff",
    color: !enabled ? "#9ca3af" : "#111827",
    fontSize: 12,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.7,
    userSelect: "none",
  };
}

function circleBtn(enabled, activeRow) {
  return {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: activeRow ? "2px solid rgba(16,185,129,0.55)" : "1px solid #d1d5db",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "#f9fafb" : "#9ca3af",
    fontSize: 12,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
  };
}
