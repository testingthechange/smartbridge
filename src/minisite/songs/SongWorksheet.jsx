import React, { useState, useMemo } from "react";
import SongPlayers from "./SongPlayers";
import SongConnectionsTable from "./SongConnectionsTable";

export default function SongWorksheet({
  fromSlot,
  songTitle,
  connections,
  lockMap,
  toListenChoice,
  songAUrl,
  songBUrl,
  bridgeMap,
  onPickBridge,
  onToggleLock,
  onSetChoice,
  bridgePlayer,
  abcPlayer,
}) {
  const [open, setOpen] = useState(fromSlot === 1);

  const rows = useMemo(
    () => connections.filter((c) => c.fromSlot === fromSlot),
    [connections, fromSlot]
  );

  return (
    <div style={{ marginTop: 14, border: "1px solid #e5e7eb", borderRadius: 14 }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: 14,
          cursor: "pointer",
          background: "#f8fafc",
          fontWeight: 900,
        }}
      >
        Song {fromSlot} — {songTitle(fromSlot)}
      </div>

      {open ? (
        <div style={{ padding: 16 }}>
          <SongPlayers
            bridgePlayer={bridgePlayer}
            abcPlayer={abcPlayer}
          />

          <SongConnectionsTable
            fromSlot={fromSlot}
            songTitle={songTitle}
            connections={rows}
            lockMap={lockMap}
            toListenChoice={toListenChoice}
            songAUrl={songAUrl}
            songBUrl={songBUrl}
            onPickBridge={onPickBridge}
            onToggleLock={onToggleLock}
            onSetChoice={onSetChoice}
            onPlayBridge={() => {}}
          />
        </div>
      ) : null}
    </div>
  );
}
