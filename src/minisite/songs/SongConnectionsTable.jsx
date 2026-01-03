import React from "react";

export default function SongConnectionsTable({
  fromSlot,
  songTitle,
  connections,
  lockMap,
  toListenChoice,
  songAUrl,
  songBUrl,
  onPickBridge,
  onToggleLock,
  onSetChoice,
  onPlayBridge,
}) {
  return (
    <div style={{ marginTop: 14, ...card() }}>
      <div style={sectionTitle()}>
        Connections from Song {fromSlot}
      </div>

      <div style={{ marginTop: 12 }}>
        {connections.map((row) => {
          const toSlot = Number(row.toSlot);
          if (toSlot === fromSlot) return null;

          const locked = !!lockMap?.[String(toSlot)];
          const choice = toListenChoice?.[String(toSlot)] || "A";

          return (
            <div
              key={row.key}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.5fr 1fr 120px",
                gap: 10,
                padding: 12,
                borderBottom: "1px solid #e5e7eb",
                alignItems: "center",
              }}
            >
              <div>
                <strong>Song {fromSlot}</strong>
                <div style={{ fontSize: 11, opacity: 0.6 }}>
                  {songTitle(fromSlot)}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button onClick={() => onPlayBridge(toSlot)}>▶</button>

                <label>
                  Upload
                  <input
                    type="file"
                    accept="audio/*"
                    disabled={locked}
                    style={{ display: "none" }}
                    onChange={(e) =>
                      onPickBridge(toSlot, e.target.files?.[0])
                    }
                  />
                </label>

                <span style={{ fontSize: 11 }}>
                  {row.bridgeFileName || "—"}
                </span>
              </div>

              <div>
                <div>
                  <label>
                    <input
                      type="radio"
                      checked={choice === "A"}
                      disabled={!songAUrl(toSlot) || locked}
                      onChange={() => onSetChoice(toSlot, "A")}
                    />
                    A
                  </label>

                  <label style={{ marginLeft: 10 }}>
                    <input
                      type="radio"
                      checked={choice === "B"}
                      disabled={!songBUrl(toSlot) || locked}
                      onChange={() => onSetChoice(toSlot, "B")}
                    />
                    B
                  </label>
                </div>
              </div>

              <div>
                <button onClick={() => onToggleLock(toSlot)}>
                  {locked ? "Locked" : "Unlock"}
                </button>
              </div>
            </div>
          );
        })}
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
