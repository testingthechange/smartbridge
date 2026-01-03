import React, { useEffect, useRef, useState } from "react";
import { idbGetBlob } from "./albumIdb";
import { ghostBtnSm, primaryBtnSmall } from "./albumStyles.jsx";
import { fmtTime, safeRevoke } from "./meta";

export default function AlbumSlideshowPreview({ items }) {
  const [idx, setIdx] = useState(0);
  const [auto, setAuto] = useState(false);

  const item = Array.isArray(items) && items.length ? items[Math.min(idx, items.length - 1)] : null;

  useEffect(() => {
    setIdx(0);
  }, [items?.length]);

  useEffect(() => {
    if (!auto) return;
    if (!items?.length) return;

    const t = setInterval(() => {
      setIdx((v) => {
        const next = v + 1;
        return next >= items.length ? 0 : next;
      });
    }, 2500);

    return () => clearInterval(t);
  }, [auto, items]);

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>Slideshow Preview</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" style={ghostBtnSm(!items?.length)} disabled={!items?.length} onClick={() => setIdx((v) => Math.max(0, v - 1))}>
            Prev
          </button>
          <button
            type="button"
            style={ghostBtnSm(!items?.length)}
            disabled={!items?.length}
            onClick={() => setIdx((v) => (items?.length ? (v + 1) % items.length : 0))}
          >
            Next
          </button>
          <button type="button" style={ghostBtnSm(!items?.length)} disabled={!items?.length} onClick={() => setAuto((v) => !v)}>
            Auto: {auto ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
        {items?.length ? (
          <>
            Slide <strong>{idx + 1}</strong> / {items.length} — <strong>{item?.fileName || "—"}</strong>
          </>
        ) : (
          "No slides yet."
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <SlideRenderer item={item} />
      </div>
    </div>
  );
}

function SlideRenderer({ item }) {
  const [url, setUrl] = useState("");
  const leaseRef = useRef("");

  const revoke = () => {
    safeRevoke(leaseRef.current);
    leaseRef.current = "";
  };

  useEffect(() => {
    let cancelled = false;

    async function run() {
      revoke();
      setUrl("");
      if (!item?.storeKey) return;

      const blob = await idbGetBlob(item.storeKey);
      if (!blob || cancelled) return;

      const u = URL.createObjectURL(blob);
      leaseRef.current = u;
      setUrl(u);
    }

    run();

    return () => {
      cancelled = true;
      revoke();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.storeKey]);

  if (!item) {
    return (
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          background: "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          opacity: 0.6,
        }}
      >
        Preview
      </div>
    );
  }

  const mime = String(item?.mime || "");
  const isImg = mime.startsWith("image/");
  const isPdf = mime === "application/pdf" || mime.includes("pdf");
  const isVid = mime.startsWith("video/");

  if (!url) {
    return (
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          background: "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          opacity: 0.6,
        }}
      >
        Loading…
      </div>
    );
  }

  if (isImg) {
    return (
      <div style={{ width: "100%", borderRadius: 14, overflow: "hidden", border: "1px solid #e5e7eb", background: "#f8fafc" }}>
        <img src={url} alt={item.fileName} style={{ width: "100%", height: "auto", display: "block" }} />
      </div>
    );
  }

  if (isPdf) {
    return (
      <div style={{ width: "100%", height: 420, borderRadius: 14, overflow: "hidden", border: "1px solid #e5e7eb", background: "#f8fafc" }}>
        <iframe title={item.fileName} src={url} style={{ width: "100%", height: "100%", border: "none" }} />
      </div>
    );
  }

  if (isVid) {
    return <VideoPreview url={url} />;
  }

  return (
    <div style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb", background: "#f8fafc", fontSize: 12, opacity: 0.75 }}>
      Unsupported preview type. (mime: <code>{mime || "—"}</code>)
    </div>
  );
}

function VideoPreview({ url }) {
  const vidRef = useRef(null);
  const rafRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [vol, setVol] = useState(1);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setT(0);
    setDur(0);
    const v = vidRef.current;
    if (!v) return;
    try {
      v.pause();
      v.currentTime = 0;
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const tick = () => {
    const v = vidRef.current;
    if (!v) return;
    setT(v.currentTime || 0);
    rafRef.current = requestAnimationFrame(tick);
  };

  const onLoaded = () => {
    const v = vidRef.current;
    if (!v) return;
    setDur(v.duration || 0);
  };

  const onEnded = () => {
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const playPause = async () => {
    const v = vidRef.current;
    if (!v) return;

    if (playing) {
      v.pause();
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
      return;
    }

    try {
      await v.play();
      setPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setPlaying(false);
    }
  };

  const reset = () => {
    const v = vidRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    setT(0);
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const scrub = (e) => {
    const v = vidRef.current;
    if (!v || !dur) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = rect.width ? x / rect.width : 0;

    v.currentTime = dur * pct;
    setT(v.currentTime);
  };

  const toggleMute = () => {
    const v = vidRef.current;
    if (!v) return;
    const next = !muted;
    v.muted = next;
    setMuted(next);
  };

  const setVolume = (next) => {
    const v = vidRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(1, Number(next)));
    v.volume = clamped;
    setVol(clamped);
  };

  return (
    <div>
      <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid #e5e7eb", background: "#000" }}>
        <video ref={vidRef} src={url} style={{ width: "100%", height: "auto", display: "block" }} onLoadedMetadata={onLoaded} onEnded={onEnded} />
      </div>

      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 11, opacity: 0.75, whiteSpace: "nowrap" }}>
          {fmtTime(t)} / {fmtTime(dur)}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={primaryBtnSmall(true)} onClick={playPause}>
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" style={ghostBtnSm(false)} onClick={reset}>
            Reset
          </button>
          <button type="button" style={ghostBtnSm(false)} onClick={toggleMute}>
            {muted ? "Unmute" : "Mute"}
          </button>
          <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, opacity: 0.75 }}>Vol</span>
            <input type="range" min="0" max="1" step="0.05" value={vol} onChange={(e) => setVolume(e.target.value)} style={{ width: 120 }} />
          </div>
        </div>
      </div>

      <div
        onClick={scrub}
        style={{
          marginTop: 10,
          height: 12,
          borderRadius: 999,
          border: "1px solid #e5e7eb",
          background: "#f3f4f6",
          overflow: "hidden",
          cursor: dur ? "pointer" : "not-allowed",
          opacity: dur ? 1 : 0.6,
        }}
      >
        <div style={{ width: `${dur ? Math.round((t / dur) * 100) : 0}%`, height: "100%", background: "#111827", opacity: 0.35 }} />
      </div>
    </div>
  );
}
