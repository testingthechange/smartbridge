import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * AbcBridgePlayer
 * - NFT Mix rule: A + Bridge + A (Version A ONLY)
 * - Scrub is GLOBAL across A → Bridge → A
 *
 * Props:
 *   aUrl: string (Catalog A playbackUrl)
 *   bridgeUrl: string (uploaded bridge playbackUrl)   (can be "" if missing)
 *   title: string (row label)
 *   onPhaseChange?: (phase: "A1"|"BRIDGE"|"A2") => void
 */
export default function AbcBridgePlayer({ aUrl, bridgeUrl, title, onPhaseChange }) {
  const audioRef = useRef(null);

  // segments: [A1, BRIDGE, A2]
  const segs = useMemo(() => {
    const A = String(aUrl || "").trim();
    const B = String(bridgeUrl || "").trim();
    return [
      { id: "A1", url: A, dur: 0 },
      { id: "BRIDGE", url: B, dur: 0 },
      { id: "A2", url: A, dur: 0 },
    ];
  }, [aUrl, bridgeUrl]);

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState(false);

  // segment durations (measured via hidden audio loaders)
  const [durA, setDurA] = useState(0);
  const [durBridge, setDurBridge] = useState(0);

  // global time (0..total)
  const [t, setT] = useState(0);

  // which segment is currently loaded in the single playback audio
  const phaseRef = useRef("A1"); // "A1"|"BRIDGE"|"A2"
  const segStartRef = useRef(0); // global start time of current segment
  const localOffsetRef = useRef(0); // local time into current segment

  const total = useMemo(() => {
    const a = Number(durA) || 0;
    const b = Number(durBridge) || 0;
    return a + b + a;
  }, [durA, durBridge]);

  const canPlay = useMemo(() => {
    // must have A; bridge optional (but ABC will still function as A+A if bridge missing)
    return !!String(aUrl || "").trim();
  }, [aUrl]);

  // ---- helper: load duration for a URL without touching the main player
  const probeDuration = (url, cb) => {
    const u = String(url || "").trim();
    if (!u) return cb(0);

    const tmp = new Audio();
    tmp.preload = "metadata";
    tmp.src = u;

    const cleanup = () => {
      tmp.removeEventListener("loadedmetadata", onMeta);
      tmp.removeEventListener("error", onErr);
      // Let GC collect tmp
    };

    const onMeta = () => {
      const d = Number(tmp.duration);
      cleanup();
      cb(Number.isFinite(d) && d > 0 ? d : 0);
    };

    const onErr = () => {
      cleanup();
      cb(0);
    };

    tmp.addEventListener("loadedmetadata", onMeta);
    tmp.addEventListener("error", onErr);
  };

  // probe A and Bridge durations (once when urls change)
  useEffect(() => {
    setReady(false);
    setErr("");
    setT(0);
    phaseRef.current = "A1";
    segStartRef.current = 0;
    localOffsetRef.current = 0;

    const A = String(aUrl || "").trim();
    if (!A) {
      setDurA(0);
      setDurBridge(0);
      setErr("Missing Version A audio (Catalog A).");
      return;
    }

    probeDuration(A, (d) => {
      setDurA(d || 0);
    });

    const B = String(bridgeUrl || "").trim();
    if (!B) {
      setDurBridge(0);
      // still fine, acts like A + (0) + A
      setReady(true);
      return;
    }

    probeDuration(B, (d) => {
      setDurBridge(d || 0);
      setReady(true);
    });

    // if no bridge, mark ready after A probes settle a bit
    if (!B) {
      const timer = setTimeout(() => setReady(true), 50);
      return () => clearTimeout(timer);
    }
  }, [aUrl, bridgeUrl]);

  // main audio event wiring (single persistent element)
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    const onTime = () => {
      const local = Number(el.currentTime) || 0;
      localOffsetRef.current = local;
      const global = (segStartRef.current || 0) + local;
      setT(global);
    };

    const onEnded = () => {
      // advance to next segment automatically
      advanceSegment();
    };

    const onError = () => {
      setErr("Audio failed to load/play.");
      setPlaying(false);
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);

    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durA, durBridge]);

  const setPhase = (phase) => {
    phaseRef.current = phase;
    if (onPhaseChange) onPhaseChange(phase);
  };

  const loadSegment = async (phase, localTime = 0, autoplay = false) => {
    const el = audioRef.current;
    if (!el) return;

    const A = String(aUrl || "").trim();
    const B = String(bridgeUrl || "").trim();

    let url = "";
    let segStart = 0;

    const a = Number(durA) || 0;
    const b = Number(durBridge) || 0;

    if (phase === "A1") {
      url = A;
      segStart = 0;
    } else if (phase === "BRIDGE") {
      url = B || ""; // if missing, skip
      segStart = a;
    } else {
      url = A;
      segStart = a + b;
    }

    // if bridge missing and asked to load bridge, skip to A2
    if (phase === "BRIDGE" && !url) {
      return loadSegment("A2", 0, autoplay);
    }

    setPhase(phase);
    segStartRef.current = segStart;

    // only swap src if changed
    if (el.src !== url) {
      el.src = url;
      el.load();
    }

    // seek after metadata is available
    const seek = () => {
      try {
        el.currentTime = Math.max(0, Number(localTime) || 0);
      } catch {}
    };

    if (Number.isFinite(el.duration) && el.duration > 0) {
      seek();
    } else {
      const onMeta = () => {
        el.removeEventListener("loadedmetadata", onMeta);
        seek();
      };
      el.addEventListener("loadedmetadata", onMeta);
    }

    if (autoplay) {
      try {
        await el.play();
      } catch {
        // ignore autoplay restrictions
      }
    }
  };

  const advanceSegment = () => {
    const phase = phaseRef.current;
    if (phase === "A1") return loadSegment("BRIDGE", 0, true);
    if (phase === "BRIDGE") return loadSegment("A2", 0, true);
    // end at A2
    setPlaying(false);
  };

  const onPlayPause = async () => {
    if (!canPlay) return;
    if (!ready) return;

    const el = audioRef.current;
    if (!el) return;

    if (!el.src) {
      // start fresh at A1
      return loadSegment("A1", 0, true);
    }

    if (el.paused) {
      try {
        await el.play();
      } catch {}
    } else {
      el.pause();
    }
  };

  const onReset = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setPlaying(false);
    setErr("");
    setT(0);
    loadSegment("A1", 0, false);
  };

  const scrubTo = (globalTime) => {
    const g = Math.max(0, Math.min(Number(globalTime) || 0, total || 0));

    const a = Number(durA) || 0;
    const b = Number(durBridge) || 0;

    // map global time to segment + local time
    if (g <= a || b === 0) {
      // A1 (or bridge missing => treat as A1 until a, then jump to A2)
      if (g <= a) return loadSegment("A1", g, false);
      // bridge missing and g>a -> A2 with local (g - a)
      return loadSegment("A2", g - a, false);
    }

    if (g <= a + b) {
      // BRIDGE
      return loadSegment("BRIDGE", g - a, false);
    }

    // A2
    return loadSegment("A2", g - (a + b), false);
  };

  const fmt = (sec) => {
    const n = Number(sec);
    if (!Number.isFinite(n) || n < 0) return "0:00";
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>{title}</div>
        <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.8 }}>
          {fmt(t)} / {fmt(total)}
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "#991b1b", background: "#fee2e2", border: "1px solid #fecaca", padding: 10, borderRadius: 12 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          onClick={onPlayPause}
          disabled={!canPlay || !ready}
          style={{
            padding: "10px 14px",
            borderRadius: 14,
            border: "1px solid #111827",
            background: !canPlay || !ready ? "#e5e7eb" : "#111827",
            color: !canPlay || !ready ? "#6b7280" : "#f9fafb",
            fontWeight: 900,
            cursor: !canPlay || !ready ? "not-allowed" : "pointer",
            minWidth: 110,
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>

        <input
          type="range"
          min={0}
          max={total || 0}
          step={0.01}
          value={Math.min(t, total || 0)}
          onChange={(e) => scrubTo(e.target.value)}
          disabled={!total || !canPlay || !ready}
          style={{ flex: 1, height: 28 }}
        />

        <button
          type="button"
          onClick={onReset}
          style={{
            padding: "10px 14px",
            borderRadius: 14,
            border: "1px solid #d1d5db",
            background: "#fff",
            color: "#111827",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Reset
        </button>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
        Phase: <strong>{phaseRef.current === "A1" ? "A" : phaseRef.current === "BRIDGE" ? "Bridge" : "A"}</strong>{" "}
        <span style={{ opacity: 0.65 }}>(A + Bridge + A, Version A only)</span>
      </div>

      <audio ref={audioRef} preload="metadata" />
    </div>
  );
}
