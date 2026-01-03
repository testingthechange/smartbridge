// src/minisite/songs/components/Players.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/* ---------------- AudioContext helpers (singleton) ---------------- */

let __audioCtx = null;
function getAudioCtx() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!__audioCtx) __audioCtx = new AudioCtx();
  return __audioCtx;
}

async function resumeCtx() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {}
  }
}

/* ---------------- time helpers ---------------- */

function fmtTime(sec) {
  const s = Number.isFinite(sec) ? Math.max(0, sec) : 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

/**
 * Load duration for a URL via an offscreen Audio element.
 * Works for same-origin or CORS-enabled URLs.
 */
function useDurations(urls) {
  const [durations, setDurations] = useState({}); // url -> seconds

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      const next = {};
      await Promise.all(
        (urls || []).map(
          (url) =>
            new Promise((resolve) => {
              if (!url) return resolve();
              if (durations[url] && Number.isFinite(durations[url])) {
                next[url] = durations[url];
                return resolve();
              }

              try {
                const a = new Audio();
                a.crossOrigin = "anonymous";
                a.preload = "metadata";
                a.src = url;

                const done = () => {
                  const d = Number(a.duration);
                  if (Number.isFinite(d) && d > 0) next[url] = d;
                  cleanup();
                  resolve();
                };
                const fail = () => {
                  cleanup();
                  resolve();
                };
                const cleanup = () => {
                  a.onloadedmetadata = null;
                  a.onerror = null;
                  try {
                    a.src = "";
                  } catch {}
                };

                a.onloadedmetadata = done;
                a.onerror = fail;
              } catch {
                resolve();
              }
            })
        )
      );

      if (cancelled) return;
      if (Object.keys(next).length) setDurations((prev) => ({ ...(prev || {}), ...next }));
    }

    loadAll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(urls)]);

  return durations;
}

/* ---------------- Baby EQ (fail-open, never kills audio) ---------------- */

/**
 * IMPORTANT: If WebAudio can’t attach (often CORS), we bail out and keep native audio.
 */
function useBabyEq(audioRef, isActive) {
  const rafRef = useRef(null);
  const analyserRef = useRef(null);
  const connectedElRef = useRef(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!isActive) {
        setLevel(0);
        return;
      }

      const ctx = getAudioCtx();
      if (!ctx) {
        setLevel(0);
        return;
      }

      // wait for element mount
      let el = audioRef?.current || null;
      const start = performance.now();
      while (!el && performance.now() - start < 800) {
        await new Promise((r) => setTimeout(r, 16));
        if (cancelled) return;
        el = audioRef?.current || null;
      }
      if (!el) {
        setLevel(0);
        return;
      }

      if (!analyserRef.current) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.85;
        analyserRef.current = analyser;
      }

      const analyser = analyserRef.current;

      // Try to wire WebAudio (fail-open)
      let srcNode = el.__sbMediaSource || null;
      if (!srcNode || connectedElRef.current !== el) {
        try {
          srcNode = ctx.createMediaElementSource(el);
          el.__sbMediaSource = srcNode;
          connectedElRef.current = el;

          try {
            srcNode.connect(analyser);
          } catch {}
          try {
            analyser.connect(ctx.destination);
          } catch {}
        } catch {
          setLevel(0);
          return;
        }
      }

      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (cancelled) return;
        try {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / (data.length * 255);
          setLevel(avg);
        } catch {
          setLevel(0);
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      tick();
    }

    run();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setLevel(0);
      // do NOT disconnect nodes here (can cause silence)
    };
  }, [audioRef, isActive]);

  return level;
}

function BabyEqBars({ audioRef, isActive, label }) {
  const level = useBabyEq(audioRef, isActive);

  const h = (m) => {
    const v = Math.max(2, Math.min(16, 2 + level * 60 * m));
    return `${v}px`;
  };

  return (
    <div
      style={{ display: "inline-flex", alignItems: "flex-end", gap: 3, marginLeft: 8 }}
      aria-label={label || "EQ"}
      title={label || "EQ"}
    >
      <span style={eqBarStyle(h(0.7))} />
      <span style={eqBarStyle(h(1.0))} />
      <span style={eqBarStyle(h(0.85))} />
    </div>
  );
}

function eqBarStyle(height) {
  return {
    width: 4,
    height,
    borderRadius: 3,
    background: "rgba(17,24,39,0.85)",
    display: "inline-block",
  };
}

/* ---------------- shared small UI pieces ---------------- */

function uiBtn(primary = false, disabled = false) {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: primary ? "1px solid #111827" : "1px solid #d1d5db",
    background: disabled ? "#e5e7eb" : primary ? "#111827" : "#fff",
    color: disabled ? "#6b7280" : primary ? "#f9fafb" : "#111827",
    fontSize: 12,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    minWidth: 90,
  };
}

function sliderStyle(disabled = false) {
  return {
    width: "100%",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

/* ---------------- BridgePreviewPlayer (custom controls, no 3-dot menu) ---------------- */

export function BridgePreviewPlayer({
  label,
  url,
  requestPlayKey,
  activeKey,
  onPlayed,
  onPlayStateChange,
  forcePauseKey,
  playBtn, // optional legacy
  resetBtn, // optional legacy
}) {
  const audioRef = useRef(null);
  const handledPlayKeyRef = useRef("");
  const handledPauseKeyRef = useRef("");

  const [isPlaying, setIsPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [pos, setPos] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const canPlay = !!url;

  useEffect(() => onPlayStateChange?.(isPlaying), [isPlaying, onPlayStateChange]);

  // reset on URL change
  useEffect(() => {
    const el = audioRef.current;
    setIsPlaying(false);
    setDur(0);
    setPos(0);
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
    } catch {}
  }, [url]);

  // wire element events
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onLoaded = () => setDur(Number(el.duration) || 0);
    const onTime = () => setPos(Number(el.currentTime) || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, []);

  // external pause key (edge-trigger)
  useEffect(() => {
    if (!forcePauseKey) return;
    if (forcePauseKey === handledPauseKeyRef.current) return;
    handledPauseKeyRef.current = forcePauseKey;
    const el = audioRef.current;
    if (!el) return;
    try {
      el.pause();
      setIsPlaying(false);
    } catch {}
  }, [forcePauseKey]);

  // external play request (edge-trigger)
  useEffect(() => {
    if (!requestPlayKey) return;
    if (requestPlayKey === handledPlayKeyRef.current) return;
    handledPlayKeyRef.current = requestPlayKey;

    if (activeKey && requestPlayKey !== activeKey) return;
    if (!canPlay) return;

    const el = audioRef.current;
    if (!el) return;

    (async () => {
      await resumeCtx();
      try {
        if (url && el.src !== url) el.src = url;
        el.currentTime = 0;
        await el.play();
        setIsPlaying(true);
        onPlayed?.(requestPlayKey);
      } catch {
        setIsPlaying(false);
      }
    })();
  }, [requestPlayKey, activeKey, canPlay, url, onPlayed]);

  // apply volume/mute
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.volume = clamp(volume, 0, 1);
      el.muted = !!muted;
    } catch {}
  }, [volume, muted]);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el || !canPlay) return;

    if (isPlaying) {
      try {
        el.pause();
      } catch {}
      setIsPlaying(false);
      return;
    }

    await resumeCtx();
    try {
      // if url changed under us
      if (url && el.src !== url) el.src = url;
      await el.play();
      setIsPlaying(true);
      onPlayed?.(activeKey || requestPlayKey || "");
    } catch {
      setIsPlaying(false);
    }
  };

  const reset = () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
    } catch {}
    setIsPlaying(false);
    setPos(0);
  };

  const seek = (t) => {
    const el = audioRef.current;
    if (!el) return;
    const next = clamp(t, 0, Number.isFinite(dur) && dur > 0 ? dur : 0);
    try {
      el.currentTime = next;
      setPos(next);
    } catch {}
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>
          {label || "Bridge"}{" "}
          <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>
            {fmtTime(pos)} / {fmtTime(dur)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <BabyEqBars audioRef={audioRef} isActive={isPlaying} label="Bridge EQ" />
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={toggle}
          disabled={!canPlay}
          style={playBtn ? playBtn(canPlay) : uiBtn(true, !canPlay)}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={reset} style={resetBtn ? resetBtn() : uiBtn(false, false)}>
          Reset
        </button>

        <button type="button" onClick={() => setMuted((m) => !m)} style={uiBtn(false, false)} title="Mute">
          {muted ? "Unmute" : "Mute"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 220, flex: "1 1 220px" }}>
          <div style={{ fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" }}>Vol</div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={sliderStyle(false)}
            aria-label="Volume"
          />
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <input
          type="range"
          min="0"
          max={Math.max(0, dur || 0)}
          step="0.01"
          value={clamp(pos, 0, Math.max(0, dur || 0))}
          onInput={(e) => seek(Number(e.target.value))}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!canPlay || !(dur > 0)}
          style={sliderStyle(!canPlay || !(dur > 0))}
          aria-label="Bridge scrubber"
        />
      </div>

      {/* hidden native audio (NO controls → no 3-dot menu) */}
      <audio ref={audioRef} crossOrigin="anonymous" src={url || undefined} preload="auto" />
      {!canPlay ? <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>Upload a bridge file first.</div> : null}
    </div>
  );
}

/* ---------------- ABCTimelinePlayer (ONE unified timeline scrub) ---------------- */

export function ABCTimelinePlayer({
  label,
  aFromUrl,
  bridgeUrl,
  toUrl,
  playingEqLabel,
  playBtn, // optional legacy
  resetBtn, // optional legacy
}) {
  const audioRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | a | bridge | to
  const [elapsed, setElapsed] = useState(0); // virtual elapsed (A+Bridge+To)
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const playlist = useMemo(() => {
    const items = [];
    if (aFromUrl) items.push({ key: "a", url: aFromUrl });
    if (bridgeUrl) items.push({ key: "bridge", url: bridgeUrl });
    if (toUrl) items.push({ key: "to", url: toUrl });
    return items;
  }, [aFromUrl, bridgeUrl, toUrl]);

  const urls = useMemo(() => playlist.map((p) => p.url).filter(Boolean), [playlist]);
  const durations = useDurations(urls);

  const canPlay = playlist.length >= 2;

  const allDurationsKnown = useMemo(() => {
    if (!playlist.length) return false;
    return playlist.every((p) => Number.isFinite(durations[p.url]) && durations[p.url] > 0);
  }, [playlist, durations]);

  const totalDuration = useMemo(() => {
    let sum = 0;
    for (const p of playlist) {
      const d = durations[p.url];
      if (Number.isFinite(d) && d > 0) sum += d;
    }
    return sum;
  }, [playlist, durations]);

  const idxRef = useRef(0);

  const offsetBeforeIndex = (i) => {
    let sum = 0;
    for (let k = 0; k < i; k++) {
      const u = playlist[k]?.url;
      const d = durations[u];
      if (Number.isFinite(d) && d > 0) sum += d;
    }
    return sum;
  };

  const locateByVirtualTime = (t) => {
    const T = clamp(t, 0, Math.max(0, totalDuration || 0));
    let acc = 0;
    for (let i = 0; i < playlist.length; i++) {
      const d = Number(durations[playlist[i].url] || 0);
      if (d <= 0) continue;
      const nextAcc = acc + d;
      if (T <= nextAcc || i === playlist.length - 1) {
        return { index: i, timeInSeg: clamp(T - acc, 0, d) };
      }
      acc = nextAcc;
    }
    return { index: 0, timeInSeg: 0 };
  };

  // apply volume/mute
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.volume = clamp(volume, 0, 1);
      el.muted = !!muted;
    } catch {}
  }, [volume, muted]);

  // reset when playlist changes
  useEffect(() => {
    idxRef.current = 0;
    setPhase("idle");
    setIsPlaying(false);
    setElapsed(0);

    const el = audioRef.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
      el.src = playlist[0]?.url || "";
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(playlist)]);

  // track native audio time to update virtual elapsed
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => {
      const i = idxRef.current;
      const base = offsetBeforeIndex(i);
      const cur = Number(el.currentTime || 0);
      setElapsed(base + cur);
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(playlist), JSON.stringify(durations)]);

  const playFromIndex = async (i, startAt = 0) => {
    const el = audioRef.current;
    if (!el) return;

    const item = playlist[i];
    if (!item?.url) return;

    idxRef.current = i;
    setPhase(item.key);

    await resumeCtx();
    try {
      if (el.src !== item.url) el.src = item.url;
      el.currentTime = clamp(startAt, 0, Number(durations[item.url] || 0) || 0);
      await el.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
      setPhase("idle");
    }
  };

  const onEnded = async () => {
    const nextIndex = idxRef.current + 1;
    if (nextIndex >= playlist.length) {
      setIsPlaying(false);
      setPhase("idle");
      setElapsed(totalDuration || 0);
      return;
    }
    await playFromIndex(nextIndex, 0);
  };

  // hook ended event
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.onended = onEnded;
    return () => {
      el.onended = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(playlist), JSON.stringify(durations), totalDuration]);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el || !canPlay) return;

    if (isPlaying) {
      try {
        el.pause();
      } catch {}
      setIsPlaying(false);
      return;
    }

    if (phase === "idle") {
      await playFromIndex(0, 0);
      return;
    }

    await resumeCtx();
    try {
      await el.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  const reset = () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
      el.src = playlist[0]?.url || "";
    } catch {}
    idxRef.current = 0;
    setPhase("idle");
    setIsPlaying(false);
    setElapsed(0);
  };

  const scrubTo = async (tVirtual, keepPlaying = false) => {
    if (!allDurationsKnown || !canPlay) return;

    const el = audioRef.current;
    if (!el) return;

    const { index, timeInSeg } = locateByVirtualTime(tVirtual);
    idxRef.current = index;
    const item = playlist[index];
    setPhase(item.key);
    setElapsed(clamp(tVirtual, 0, totalDuration || 0));

    try {
      if (el.src !== item.url) el.src = item.url;
      el.currentTime = timeInSeg;
    } catch {}

    if (keepPlaying) {
      await resumeCtx();
      try {
        await el.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const phaseLabel = phase !== "idle" ? phase.toUpperCase() : "";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>
          {label || "A + Bridge + To"}{" "}
          <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>{phaseLabel ? `(${phaseLabel})` : ""}</span>
          <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>
            {fmtTime(elapsed)} / {fmtTime(totalDuration)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <BabyEqBars audioRef={audioRef} isActive={isPlaying} label={playingEqLabel || "Mix EQ"} />
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={toggle}
          disabled={!canPlay}
          style={playBtn ? playBtn(canPlay) : uiBtn(true, !canPlay)}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={reset} style={resetBtn ? resetBtn() : uiBtn(false, false)}>
          Reset
        </button>

        <button type="button" onClick={() => setMuted((m) => !m)} style={uiBtn(false, false)} title="Mute">
          {muted ? "Unmute" : "Mute"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 220, flex: "1 1 220px" }}>
          <div style={{ fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" }}>Vol</div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={sliderStyle(false)}
            aria-label="Volume"
          />
        </div>
      </div>

      {/* ONE unified ABC scrub timeline */}
      <div style={{ marginTop: 10 }}>
        <input
          type="range"
          min="0"
          max={Math.max(0, totalDuration || 0)}
          step="0.01"
          value={clamp(elapsed, 0, Math.max(0, totalDuration || 0))}
          disabled={!canPlay || !allDurationsKnown || !(totalDuration > 0)}
          style={sliderStyle(!canPlay || !allDurationsKnown || !(totalDuration > 0))}
          aria-label="ABC scrub timeline"
          onInput={(e) => {
            // live scrub (do not auto-play unless already playing)
            const t = Number(e.target.value);
            scrubTo(t, isPlaying);
          }}
          onChange={(e) => {
            // commit scrub
            const t = Number(e.target.value);
            scrubTo(t, isPlaying);
          }}
        />

        {!allDurationsKnown ? (
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
            Loading durations… (scrub enables once A + Bridge + To durations are known)
          </div>
        ) : null}
      </div>

      {/* hidden native audio (NO controls → no 3-dot menu) */}
      <audio ref={audioRef} crossOrigin="anonymous" preload="auto" />
      {!canPlay ? (
        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>Need at least From A + To audio URLs.</div>
      ) : null}
    </div>
  );
}
