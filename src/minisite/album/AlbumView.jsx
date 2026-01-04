import React, { useEffect } from "react";

export default function AlbumView({
  projectId,
  apiBase,
  albumName,
  setAlbumName,
  artist,
  setArtist,
  releaseDate,
  setReleaseDate,
  totalTime,
  lockMeta,
  setLockMeta,
  lockPlaylist,
  setLockPlaylist,
  songs,
  onPlay,
  audioRef,
  playing,
  setPlaying,
  time,
  setTime,
  dur,
  setDur,
}) {
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime || 0);
    const onDur = () => setDur(a.duration || 0);
    const onPlayEv = () => setPlaying(true);
    const onPauseEv = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("play", onPlayEv);
    a.addEventListener("pause", onPauseEv);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("play", onPlayEv);
      a.removeEventListener("pause", onPauseEv);
    };
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>Album</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Project <b>{projectId}</b>
            </div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>{apiBase}</div>
        </div>

        {/* META */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b>Album Meta</b>
            <button
              onClick={() => setLockMeta((v) => !v)}
              style={{
                background: lockMeta ? "#fee2e2" : "#dcfce7",
                border: "1px solid #999",
              }}
            >
              {lockMeta ? "Locked" : "Unlocked"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "35% 35%", gap: 12, marginTop: 10 }}>
            <input
              disabled={lockMeta}
              placeholder="Album Name"
              value={albumName}
              onChange={(e) => setAlbumName(e.target.value)}
            />
            <input
              disabled={lockMeta}
              placeholder="Artist"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
            />
            <input
              disabled={lockMeta}
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
            />
            <input disabled value={`Total Time: ${totalTime}`} />
          </div>
        </div>

        {/* PLAYER */}
        <div style={{ marginTop: 18 }}>
          <b>Player</b>
          <div style={{ marginTop: 8 }}>
            <button onClick={() => (audioRef.current?.paused ? audioRef.current.play() : audioRef.current.pause())}>
              {playing ? "Pause" : "Play"}
            </button>
            <span style={{ marginLeft: 10 }}>
              {Math.floor(time)} / {Math.floor(dur)}s
            </span>
            <input
              type="range"
              min={0}
              max={Math.floor(dur || 0)}
              value={Math.floor(time || 0)}
              onChange={(e) => {
                if (audioRef.current) audioRef.current.currentTime = Number(e.target.value);
              }}
              style={{ width: "100%" }}
            />
          </div>
          <audio ref={audioRef} />
        </div>

        {/* PLAYLIST */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b>Album Playlist</b>
            <button
              onClick={() => setLockPlaylist((v) => !v)}
              style={{
                background: lockPlaylist ? "#fee2e2" : "#dcfce7",
                border: "1px solid #999",
              }}
            >
              {lockPlaylist ? "Locked" : "Unlocked"}
            </button>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {songs.map((s) => (
              <div
                key={s.slot}
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 1fr 120px",
                  alignItems: "center",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <b>#{s.slot}</b>
                <div>{s.title || "Untitled"}</div>
                <button onClick={() => onPlay(s.slot, s.file?.s3Key)}>
                  {playing ? "Pause" : "Play"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
