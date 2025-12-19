// src/minisite/NFTMix.jsx
import React, { useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

const SONG_COUNT = 9;

export default function NFTMix() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  // Later: load from Catalog JSON (titles + Version A urls + cover + meta)
  const [catalogMeta] = useState({
    albumTitle: "",
    coverUrl: "",
  });

  // Placeholder until Catalog JSON: keep titles empty so we don’t print “Song 2 — Title”
  const [songs] = useState(() =>
    Array.from({ length: SONG_COUNT }).map((_, i) => ({
      number: i + 1,
      title: "",
      aUrl: "",
      aFileName: "",
    }))
  );

  // 1→2, 2→3, ... 8→9
  const [glueLines, setGlueLines] = useState(() =>
    Array.from({ length: SONG_COUNT - 1 }).map((_, i) => ({
      id: `glue-${i + 1}-to-${i + 2}`,
      from: i + 1,
      to: i + 2,
      fromVer: "A",
      toVer: "A",
      bridgeFileName: "",
      bridgeUrl: "",
      locked: false,
      abcPreviewUrl: "", // later from converter
    }))
  );

  const [durMap, setDurMap] = useState({}); // key -> seconds
  const totalMixSeconds = useMemo(() => {
    return Object.values(durMap).reduce((a, b) => a + (Number(b) || 0), 0);
  }, [durMap]);

  const allLinesComplete = useMemo(() => {
    return glueLines.every((l) => !!l.bridgeFileName);
  }, [glueLines]);

  const handlePickBridge = (idx, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);

    setGlueLines((prev) => {
      const copy = [...prev];
      safeRevoke(copy[idx].bridgeUrl);
      copy[idx] = {
        ...copy[idx],
        bridgeFileName: file.name,
        bridgeUrl: url,
      };
      return copy;
    });
  };

  const toggleLock = (idx) => {
    setGlueLines((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], locked: !copy[idx].locked };
      return copy;
    });
  };

  const handleMasterSave = () => {
    if (!allLinesComplete) {
      window.alert(
        "Master Save refused.\n\nPlease upload ALL bridge files before continuing."
      );
      return;
    }

    const first = window.confirm(
      "Are you sure you want to perform a Master Save from NFT Mix?\n\nThis will lock in your NFT mix glue lines."
    );
    if (!first) return;

    const second = window.confirm(
      "Last chance.\n\nMake sure everything is complete before continuing."
    );
    if (!second) return;

    window.alert("UI only: NFT Mix Master Save complete.");
  };

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Small header (magic-link requirement) */}
      <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 12 }}>
        Project ID: <code>{projectId}</code>
        {token ? (
          <>
            {" "}
            · Link: <code>{token.slice(0, 10)}…</code>
          </>
        ) : null}
      </div>

      {/* Title */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a" }}>
            NFT Mix
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            Glue format (giveaway MP3): <strong>A + Bridge + A</strong>{" "}
            continuous. Source defaults to <strong>Version A</strong>.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            fontSize: 12,
            opacity: 0.75,
            alignItems: "flex-end",
          }}
        >
          <div>
            # of Songs: <strong>{songs.length}</strong>
          </div>
          <div>
            Mix Time: <strong>{fmtTime(totalMixSeconds)}</strong>
          </div>
        </div>
      </div>

      {/* Cover (optional) */}
      <div style={{ marginTop: 14, ...card() }}>
        <div style={sectionTitle()}>Album Cover (from Catalog)</div>

        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 14,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 14,
              border: "1px solid #e5e7eb",
              background: "#f8fafc",
              overflow: "hidden",
              flex: "0 0 auto",
            }}
          >
            {catalogMeta.coverUrl ? (
              <img
                src={catalogMeta.coverUrl}
                alt="Cover"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            ) : null}
          </div>

          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Project:{" "}
            <strong>{catalogMeta.albumTitle || "[ Album Title ]"}</strong>
            <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
              (UI only: cover comes from Catalog JSON later)
            </div>
          </div>
        </div>
      </div>

      {/* Glue lines */}
      <div style={{ marginTop: 14, ...card() }}>
        <div style={sectionTitle()}>Glue / Bridge Lines</div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          Each row is <strong>FROM</strong> + <strong>BRIDGE</strong> +{" "}
          <strong>TO</strong>. (Removed song-title + ver text per your request.)
        </div>

        <div
          style={{
            marginTop: 12,
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 2.2fr 1.2fr",
              padding: "10px 12px",
              background: "#f8fafc",
              borderBottom: "1px solid #e5e7eb",
              fontSize: 11,
              fontWeight: 900,
              opacity: 0.75,
              textTransform: "uppercase",
              letterSpacing: 0.2,
              gap: 10,
              alignItems: "center",
            }}
          >
            <div>From</div>
            <div>Bridge</div>
            <div>To</div>
          </div>

          {glueLines.map((line, idx) => (
            <div
              key={line.id}
              style={{
                padding: "12px 12px",
                borderBottom:
                  idx === glueLines.length - 1 ? "none" : "1px solid #e5e7eb",
                background: line.locked ? "#fee2e2" : "#fff",
              }}
            >
              {/* SELECT ROW (clean) */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 2.2fr 1.2fr",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                {/* FROM (no song title / no ver text) */}
                <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>
                  Song {line.from}
                </div>

                {/* BRIDGE upload + filename */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <label
                    style={{
                      display: "inline-block",
                      padding: "8px 12px",
                      borderRadius: 10,
                      background: line.locked ? "#e5e7eb" : "#22c55e",
                      color: line.locked ? "#6b7280" : "#064e3b",
                      fontSize: 12,
                      fontWeight: 900,
                      cursor: line.locked ? "not-allowed" : "pointer",
                      border: "1px solid #16a34a",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Upload Bridge
                    <input
                      type="file"
                      accept="audio/*"
                      disabled={line.locked}
                      style={{ display: "none" }}
                      onChange={(e) =>
                        handlePickBridge(idx, e.target.files?.[0] || null)
                      }
                    />
                  </label>

                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.75,
                      textAlign: "right",
                      flex: 1,
                    }}
                  >
                    {line.bridgeFileName ? (
                      <code style={{ wordBreak: "break-word" }}>
                        {line.bridgeFileName}
                      </code>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>

                {/* TO (no song title / no ver text) */}
                <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>
                  Song {line.to}
                </div>
              </div>

              {/* PLAYERS */}
              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 120px",
                  gap: 12,
                  alignItems: "start",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 900,
                      opacity: 0.65,
                      textTransform: "uppercase",
                    }}
                  >
                    Bridge Preview
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <MiniPlayer
                      label={`Bridge ${line.from}→${line.to}`}
                      url={line.bridgeUrl}
                      disabled={!line.bridgeUrl}
                      onDuration={(sec) =>
                        setDurMap((prev) => ({
                          ...prev,
                          [`bridge-${line.id}`]: sec,
                        }))
                      }
                    />
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 900,
                      opacity: 0.65,
                      textTransform: "uppercase",
                    }}
                  >
                    A + Bridge + A Preview
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <MiniPlayer
                      label={`A+B+C ${line.from}→${line.to}`}
                      url={line.abcPreviewUrl}
                      disabled={!line.abcPreviewUrl}
                      onDuration={(sec) =>
                        setDurMap((prev) => ({
                          ...prev,
                          [`abc-${line.id}`]: sec,
                        }))
                      }
                    />
                    <div style={{ marginTop: 6, fontSize: 11, opacity: 0.65 }}>
                      (UI only: preview output wired via Export/Tools later)
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => toggleLock(idx)}
                    style={lockBtn(line.locked)}
                  >
                    {line.locked ? "Locked" : "Unlock"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Full Mix Preview */}
      <div style={{ marginTop: 14, ...card() }}>
        <div style={sectionTitle()}>Full Mix Preview</div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          NFT Mix MP3 Preview (shows full time of mix).
        </div>

        <div style={{ marginTop: 10 }}>
          <MiniPlayer
            label="NFT Mix MP3"
            url={""}
            disabled={true}
            onDuration={(sec) => setDurMap((p) => ({ ...p, fullMix: sec }))}
          />
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.65 }}>
            (UI only: full mix output comes from converter later)
          </div>
        </div>
      </div>

      {/* Export hook */}
      <div style={{ marginTop: 14, ...card() }}>
        <div style={sectionTitle()}>Export / Converter Hook</div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={ghostBtn()}>
            Generate NFT Mix JSON
          </button>
          <button type="button" style={ghostBtn()}>
            Copy JSON
          </button>
          <button type="button" style={ghostBtn()}>
            Push to S3
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.65 }}>
          Note: Glue player output connects to <strong>Export/Tools</strong>{" "}
          converter.
        </div>
      </div>

      {/* Master Save */}
      <div style={{ marginTop: 14, ...card() }}>
        <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
          <strong>Master Save</strong> is the second layer of saving. Two
          confirmations required.
          <br />
          Rule (now): requires all glue lines have a bridge file uploaded.
        </div>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={primaryBtn()} onClick={handleMasterSave}>
            Master Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- mini custom player (no 3-dot menu) ---------------- */

function MiniPlayer({ label, url, disabled, onDuration }) {
  const audioRef = useRef(null);
  const rafRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  const tick = () => {
    const el = audioRef.current;
    if (!el) return;
    setT(el.currentTime || 0);
    rafRef.current = requestAnimationFrame(tick);
  };

  const onLoaded = () => {
    const el = audioRef.current;
    if (!el) return;
    const d = el.duration || 0;
    setDur(d);
    onDuration?.(d);
  };

  const onEnded = () => {
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const toggle = async () => {
    if (disabled) return;
    const el = audioRef.current;
    if (!el) return;

    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
      return;
    }

    try {
      await el.play();
      setIsPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setIsPlaying(false);
    }
  };

  const scrub = (e) => {
    const el = audioRef.current;
    if (!el || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const nextPct = rect.width ? x / rect.width : 0;
    el.currentTime = dur * nextPct;
    setT(el.currentTime);
  };

  const reset = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setT(0);
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const pct = dur ? Math.min(1, t / dur) : 0;

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 12,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "baseline",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 900 }}>{label}</div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          {fmtTime(t)} / {fmtTime(dur)}
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={toggle} style={playBtn(!disabled)}>
          {isPlaying ? "Pause" : "Play"}
        </button>

        <div
          onClick={scrub}
          title={disabled ? "Missing audio" : "Click to scrub"}
          style={{
            flex: 1,
            height: 12,
            borderRadius: 999,
            border: "1px solid #e5e7eb",
            background: "#f3f4f6",
            overflow: "hidden",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
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

      <audio ref={audioRef} src={url || ""} onLoadedMetadata={onLoaded} onEnded={onEnded} />
    </div>
  );
}

/* ---------------- helpers/styles ---------------- */

function fmtTime(s) {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

function safeRevoke(url) {
  if (!url) return;
  if (typeof url === "string" && url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }
}

function card() {
  return {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 16,
  };
}

function sectionTitle() {
  return {
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.2,
    textTransform: "uppercase",
  };
}

function primaryBtn() {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: "#111827",
    color: "#f9fafb",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
  };
}

function ghostBtn() {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
  };
}

function lockBtn(locked) {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: locked ? "#ef4444" : "#fff",
    color: locked ? "#fff" : "#111827",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  };
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
    width: 70,
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
