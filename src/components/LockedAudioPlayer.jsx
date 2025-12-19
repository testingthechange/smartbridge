// src/components/LockedAudioPlayer.jsx
import React, { useEffect, useRef, useState } from "react";
import { getPlaybackUrl } from "../lib/getPlaybackUrl.js";

export default function LockedAudioPlayer({ locked, mp3 }) {
  const audioRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [src, setSrc] = useState("");
  const [err, setErr] = useState("");

  const s3Key = mp3?.s3Key || "";

  useEffect(() => {
    // if file changes or unlock happens, reset player
    setSrc("");
    setErr("");
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
  }, [locked, s3Key]);

  async function onPlay() {
    if (!locked) return;
    if (!s3Key) return;

    setErr("");
    setBusy(true);
    try {
      // Always fetch a fresh presigned URL right before play.
      const freshUrl = await getPlaybackUrl(s3Key);
      setSrc(freshUrl);

      // wait a tick so <audio src> updates
      requestAnimationFrame(() => {
        audioRef.current?.play?.().catch(() => {});
      });
    } catch (e) {
      setErr(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = !locked || !s3Key || busy;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={onPlay} disabled={disabled}>
          {busy ? "Loading..." : "Play"}
        </button>

        {!locked && <span style={{ fontSize: 12, opacity: 0.7 }}>Lock to enable playback</span>}
        {locked && !s3Key && <span style={{ fontSize: 12, opacity: 0.7 }}>Upload MP3 to enable playback</span>}
      </div>

      <audio ref={audioRef} controls src={src || undefined} />

      {!!err && <div style={{ color: "crimson", fontSize: 12 }}>{err}</div>}
    </div>
  );
}
