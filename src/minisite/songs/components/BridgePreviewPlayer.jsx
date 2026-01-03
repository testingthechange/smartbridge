// src/minisite/songs/components/BridgePreviewPlayer.jsx
import React, { useEffect, useRef, useState } from "react";

export default function BridgePreviewPlayer({
  label,
  url,
  requestPlayKey,
  activeKey,
  onPlayed,
  onPlayStateChange,
  forcePauseKey,
}) {
  const audioRef = useRef(null);
  const rafRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  const canPlay = !!url;

  const stopRaf = () => cancelAnimationFrame(rafRef.current);
  const tick = () => {
    const el = audioRef.current;
    if (!el) return;
    setT(el.currentTime || 0);
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.pause();
    } catch {}
    stopRaf();
    setIsPlaying(false);
    onPlayStateChange?.(false);
    setT(0);
    setDur(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    // parent cleared key => force pause
    if (forcePauseKey) return;

    const el = audioRef.current;
    if (!el) return;

    try {
      el.pause();
    } catch {}

    stopRaf();
    setIsPlaying(false);
    onPlayStateChange?.(false);
    setT(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcePauseKey]);

  useEffect(() => {
    if (!requestPlayKey) return;
    if (!activeKey) return;
    if (requestPlayKey !== activeKey) return;
    if (!canPlay) return;

    const go = async () => {
      const el = audioRef.current;
      if (!el) return;
      try {
        await el.play();
        setIsPlaying(true);
        onPlayStateChange?.(true);
        stopRaf();
        rafRef.current = requestAnimationFrame(tick);
        onPlayed?.(requestPlayKey);
      } catch {
        setIsPlaying(false);
        onPlayStateChange?.(false);
      }
    };

    go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestPlayKey, activeKey, canPlay]);

  const toggle = async () => {
    if (!canPlay) return;
    const el = audioRef.current;
    if (!el) return;

    if (isPlaying) {
      try {
        el.pause();
      } catch {}
      setIsPlaying(false);
      onPlayStateChange?.(false);
      stopRaf();
      return;
    }

    try {
      await el.play();
      setIsPlaying(true);
      onPlayStateChange?.(true);
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setIsPlaying(false);
      onPlayStateChange?.(false);
    }
  };

  const reset = () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
    } catch {}
    setT(0);
    setIsPlaying(false);
    onPlayStateChange?.(false);
    stopRaf();
  };

  const scrub = (e) => {
    const el = audioRef.current;
    if (!el || !dur || !canPlay) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = rect.width ? x / rect.width : 0;
    try {
      el.currentTime = dur * pct;
      setT(el.currentTime);
    } catch {}
  };

  const pct = dur ? Math.min(1, t / dur) : 0;

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 900 }}>{label}</div>
          <PlayingEq active={isPlaying} />
        </div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          {fmtTime(t)} / {fmtTime(dur)}
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={toggle} style={playBtn(canPlay)}>
          {isPlaying ? "Pause" : "Play"}
        </button>

        <div
          onClick={scrub}
          title={canPlay ? "Click to scrub" : "Missing bridge audio"}
          style={{
            flex: 1,
            height: 12,
            borderRadius: 999,
            border: "1px solid #e5e7eb",
            background: "#f3f4f6",
            overflow: "hidden",
            cursor: canPlay && dur ? "pointer" : "not-allowed",
            opacity: canPlay ? 1 : 0.5,
          }}
        >
          <div
            style={{
              width: `${Math.round(pct * 100)}%`,
              height: "100%",
              background: "#111827",
              opacity: 0.35,
            }}
          />
        </div>

        <button type="button" onClick={reset} style={resetBtn()}>
          Reset
        </button>
      </div>

      <audio
        ref={audioRef}
        src={url || undefined}
        onLoadedMetadata={() => {
          const el = audioRef.current;
          if (!el) return;
          setDur(Number(el.duration) || 0);
        }}
        onTimeUpdate={() => {
          const el = audioRef.current;
          if (!el) return;
          setT(el.currentTime || 0);
        }}
        onEnded={() => {
          setIsPlaying(false);
          onPlayStateChange?.(false);
          stopRaf();
        }}
      />
    </div>
  );
}

/* ---------------- tiny playing indicator ---------------- */

function PlayingEq({ active }) {
  return (
    <span
      aria-label={active ? "Playing" : "Not playing"}
      title={active ? "Playing" : ""}
      style={{
        display: "inline-flex",
        gap: 2,
        alignItems: "flex-end",
        height: 12,
        width: 16,
        opacity: active ? 1 : 0,
        transform: active ? "scale(1)" : "scale(0.9)",
        transition: "opacity 120ms ease, transform 120ms ease",
      }}
    >
      <span style={eqBarStyle(active, 1)} />
      <span style={eqBarStyle(active, 2)} />
      <span style={eqBarStyle(active, 3)} />
    </span>
  );
}

function eqBarStyle(active, n) {
  const base = {
    display: "inline-block",
    width: 3,
    borderRadius: 2,
    background: active ? "#111827" : "transparent",
    transformOrigin: "bottom",
  };

  if (!active) return { ...base, height: 0 };
  const h = n === 1 ? 10 : n === 2 ? 6 : 8;
  return { ...base, height: h, opacity: 0.55 };
}

/* ---------------- helpers/styles ---------------- */

function fmtTime(s) {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

function playBtn(enabled) {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "#f9fafb" : "#6b7280",
    fontSize: 12,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
    width: 80,
  };
}

function resetBtn() {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  };
}
