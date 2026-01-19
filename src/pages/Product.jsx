import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

/**
 * Product page (preview)
 * - NO header/nav rendered here (prevents double global header)
 * - Loads manifest from public S3 path:
 *   https://block-7306-player.s3.us-west-1.amazonaws.com/public/players/<shareId>/manifest.json
 * - Renders cover from manifest.coverUrl (public, non-expiring)
 * - Album Info card is TOP of column 2
 * - Player controls drive a real <audio> element and play the selected track
 */

const S3_PUBLIC_BASE =
  "https://block-7306-player.s3.us-west-1.amazonaws.com/public/players";

function fmtTime(sec) {
  const s = Number(sec || 0);
  if (!Number.isFinite(s) || s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function Product() {
  const { shareId } = useParams();

  const manifestUrl = useMemo(() => {
    if (!shareId) return "";
    return `${S3_PUBLIC_BASE}/${shareId}/manifest.json`;
  }, [shareId]);

  const fallbackCoverUrl = useMemo(() => {
    if (!shareId) return "";
    return `${S3_PUBLIC_BASE}/${shareId}/cover.png`;
  }, [shareId]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [manifest, setManifest] = useState(null);

  const tracks = useMemo(() => {
    const t = Array.isArray(manifest?.tracks) ? manifest.tracks : [];
    return t
      .map((x) => ({
        slot: Number(x?.slot || 0),
        title: String(x?.title || "").trim() || `Track ${Number(x?.slot || 0)}`,
        playbackUrl: String(x?.playbackUrl || "").trim(),
        durationSec: Number(x?.durationSec || 0),
      }))
      .filter((x) => x.slot > 0 && x.playbackUrl);
  }, [manifest]);

  const albumTitle = String(manifest?.albumTitle || manifest?.meta?.albumTitle || "Album");
  const artistName = String(manifest?.meta?.artistName || "");
  const releaseDate = String(manifest?.meta?.releaseDate || "");

  const coverUrl = useMemo(() => {
    const u = String(manifest?.coverUrl || "").trim();
    if (u) return u;
    return fallbackCoverUrl;
  }, [manifest, fallbackCoverUrl]);

  const audioRef = useRef(null);

  const [activeIndex, setActiveIndex] = useState(0);
  const activeTrack = tracks[activeIndex] || null;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Load manifest
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr("");
      setManifest(null);
      setActiveIndex(0);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);

      try {
        if (!manifestUrl) throw new Error("Missing shareId");
        const r = await fetch(manifestUrl, { method: "GET" });
        if (!r.ok) throw new Error(`Manifest HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        setManifest(j);
      } catch (e) {
        if (cancelled) return;
        setErr(String(e?.message || e));
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [manifestUrl]);

  // Keep audio element source in sync with active track
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const nextSrc = String(activeTrack?.playbackUrl || "").trim();
    if (!nextSrc) {
      a.removeAttribute("src");
      a.load();
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    // If src changed, reset time and (optionally) play
    const prevSrc = a.getAttribute("src") || "";
    if (prevSrc !== nextSrc) {
      a.setAttribute("src", nextSrc);
      a.load();
      setCurrentTime(0);
      setDuration(0);

      // If user was already playing, continue on the newly-selected track
      if (isPlaying) {
        const p = a.play();
        if (p && typeof p.catch === "function") p.catch(() => setIsPlaying(false));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack?.playbackUrl]);

  // Wire audio events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(a.currentTime || 0);
    const onMeta = () => setDuration(a.duration || 0);
    const onEnded = () => {
      // advance to next track
      if (!tracks.length) return;
      const next = (activeIndex + 1) % tracks.length;
      setActiveIndex(next);

      // try to continue playback
      requestAnimationFrame(() => {
        const aa = audioRef.current;
        if (!aa) return;
        const p = aa.play();
        if (p && typeof p.catch === "function") p.catch(() => setIsPlaying(false));
      });
    };

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnded);
    };
  }, [activeIndex, tracks.length]);

  function handlePlayPause() {
    const a = audioRef.current;
    if (!a) return;

    // If no track loaded yet, select first playable track
    if (!activeTrack && tracks.length) setActiveIndex(0);

    if (a.paused) {
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => setIsPlaying(false));
    } else {
      a.pause();
    }
  }

  function handlePrev() {
    if (!tracks.length) return;
    const next = (activeIndex - 1 + tracks.length) % tracks.length;
    setActiveIndex(next);
    setIsPlaying(true);
    requestAnimationFrame(() => {
      const a = audioRef.current;
      if (!a) return;
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => setIsPlaying(false));
    });
  }

  function handleNext() {
    if (!tracks.length) return;
    const next = (activeIndex + 1) % tracks.length;
    setActiveIndex(next);
    setIsPlaying(true);
    requestAnimationFrame(() => {
      const a = audioRef.current;
      if (!a) return;
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => setIsPlaying(false));
    });
  }

  function handleSeek(e) {
    const a = audioRef.current;
    if (!a) return;
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    a.currentTime = v;
    setCurrentTime(v);
  }

  const pageWrapStyle = {
    padding: "24px 16px 92px",
    maxWidth: 1200,
    margin: "0 auto",
  };

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "1.6fr 1fr",
    gap: 18,
    alignItems: "start",
  };

  const cardStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 18,
    padding: 16,
    backdropFilter: "blur(10px)",
  };

  const h1Style = { fontSize: 44, lineHeight: "1.05", margin: "6px 0 14px" };

  const labelStyle = { fontSize: 12, opacity: 0.7, marginBottom: 4 };
  const valueStyle = { fontSize: 16, fontWeight: 650, marginBottom: 10 };

  const btnStyle = {
    width: "100%",
    borderRadius: 14,
    padding: "14px 14px",
    fontSize: 18,
    fontWeight: 700,
    border: "1px solid rgba(0,0,0,0.0)",
    cursor: "pointer",
  };

  const pillBtnStyle = {
    borderRadius: 14,
    padding: "10px 14px",
    fontSize: 16,
    fontWeight: 650,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.92)",
    cursor: "pointer",
  };

  if (loading) {
    return (
      <div style={pageWrapStyle}>
        <div style={{ ...cardStyle, padding: 18 }}>Loading…</div>
        <audio ref={audioRef} />
      </div>
    );
  }

  if (err) {
    return (
      <div style={pageWrapStyle}>
        <div style={{ ...cardStyle, padding: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Failed to load</div>
          <div style={{ fontSize: 13, opacity: 0.8, whiteSpace: "pre-wrap" }}>{err}</div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
            Manifest URL:
            <div style={{ wordBreak: "break-all", marginTop: 4 }}>{manifestUrl}</div>
          </div>
        </div>
        <audio ref={audioRef} />
      </div>
    );
  }

  return (
    <div style={pageWrapStyle}>
      {/* IMPORTANT: Do NOT render any site header/nav here to avoid double global header. */}

      <div style={{ ...h1Style, fontWeight: 800 }}>{albumTitle}</div>

      <div style={gridStyle}>
        {/* Column 1 */}
        <div style={cardStyle}>
          <div style={{ fontSize: 16, fontWeight: 750, marginBottom: 10 }}>Album</div>

          <div
            style={{
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.10)",
              overflow: "hidden",
              background: "rgba(0,0,0,0.22)",
              height: 420,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt="Album cover"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={(e) => {
                  // If a bad URL sneaks in, fall back to the known public cover path
                  if (fallbackCoverUrl && e?.currentTarget?.src !== fallbackCoverUrl) {
                    e.currentTarget.src = fallbackCoverUrl;
                  }
                }}
              />
            ) : (
              <div style={{ opacity: 0.7 }}>No cover</div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, opacity: 0.9 }}>
              Tracks
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {tracks.length ? (
                tracks.map((t, idx) => {
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={`${t.slot}-${idx}`}
                      type="button"
                      onClick={() => {
                        setActiveIndex(idx);
                        // Do not autoplay on click unless currently playing.
                        // If currently playing, continue playback on the new track.
                        if (isPlaying) {
                          requestAnimationFrame(() => {
                            const a = audioRef.current;
                            if (!a) return;
                            const p = a.play();
                            if (p && typeof p.catch === "function") p.catch(() => setIsPlaying(false));
                          });
                        }
                      }}
                      style={{
                        textAlign: "left",
                        width: "100%",
                        borderRadius: 12,
                        padding: "10px 12px",
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: isActive ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
                        color: "rgba(255,255,255,0.92)",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ fontWeight: 700 }}>
                          {t.slot}. {t.title}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>{fmtTime(t.durationSec)}</div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div style={{ opacity: 0.75, fontSize: 13 }}>No playable tracks found.</div>
              )}
            </div>
          </div>
        </div>

        {/* Column 2 */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* (3) Album Info card MUST be TOP of column 2 */}
          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Album Info</div>

            <div style={labelStyle}>Album name</div>
            <div style={valueStyle}>{albumTitle}</div>

            <div style={labelStyle}>Performer</div>
            <div style={valueStyle}>{artistName || "—"}</div>

            <div style={labelStyle}>Release date</div>
            <div style={{ ...valueStyle, marginBottom: 0 }}>{releaseDate || "—"}</div>
          </div>

          <div style={cardStyle}>
            <button
              type="button"
              style={{
                ...btnStyle,
                background: "rgba(50, 225, 210, 0.95)",
                color: "rgba(0,0,0,0.85)",
              }}
            >
              Buy — $19.50
            </button>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>What you get</div>
            <div style={{ opacity: 0.9, fontSize: 14, lineHeight: 1.55 }}>
              <div>• Smart bridge mode</div>
              <div>• Album mode</div>
              <div>• Artist control</div>
              <div>• Bonus authored bridge content</div>
              <div>• FREE MP3 album mix download included</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom mini-player (must remain on Product) */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "12px 14px",
          background: "rgba(10,10,12,0.82)",
          borderTop: "1px solid rgba(255,255,255,0.10)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: 12,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={handlePlayPause}
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.95)",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 900,
            }}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ textAlign: "center", fontSize: 12, opacity: 0.75 }}>
              Now Playing
            </div>
            <div style={{ textAlign: "center", fontSize: 16, fontWeight: 800 }}>
              {activeTrack?.title || "—"}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.75, width: 44, textAlign: "right" }}>
                {fmtTime(currentTime)}
              </div>

              <input
                type="range"
                min={0}
                max={Math.max(0, duration || 0)}
                step={0.25}
                value={Math.min(Math.max(0, currentTime), Math.max(0, duration || 0))}
                onChange={handleSeek}
                style={{ width: "100%" }}
              />

              <div style={{ fontSize: 12, opacity: 0.75, width: 44 }}>
                {fmtTime(duration)}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={handlePrev} style={pillBtnStyle}>
              Prev
            </button>
            <button type="button" onClick={handleNext} style={pillBtnStyle}>
              Next
            </button>
          </div>
        </div>

        <audio ref={audioRef} preload="metadata" />
      </div>
    </div>
  );
}
