// src/minisite/Meta.jsx
import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

const SONG_COUNT = 9;

export default function Meta() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const API_BASE = String(import.meta.env.VITE_BACKEND_URL || "").replace(/\/+$/, "");
  const storageKey = (k) => `sb:${projectId || "no-project"}:meta:${k}`;

  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [snapshot, setSnapshot] = useState(null);

  // ordered song slots (Album order) + titles (Album title fallback Catalog)
  const [orderedSlots, setOrderedSlots] = useState(() => Array.from({ length: SONG_COUNT }).map((_, i) => i + 1));
  const [titlesBySlot, setTitlesBySlot] = useState(() => ({})); // slot -> { title, titleJson }

  // meta per slot
  const [metaBySlot, setMetaBySlot] = useState(() => {
    const saved = readJSON(storageKey("metaBySlot"), null);
    if (saved && typeof saved === "object") return normalizeMetaBySlot(saved);
    return normalizeMetaBySlot({});
  });

  // persist meta draft locally
  useEffect(() => {
    writeJSON(storageKey("metaBySlot"), metaBySlot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaBySlot, projectId]);

  /* ---------------- load latest snapshot ---------------- */

  useEffect(() => {
    if (!projectId) return;
    if (!API_BASE) {
      setLoadErr("Missing VITE_BACKEND_URL in .env.local");
      return;
    }

    let cancelled = false;

    async function run() {
      setLoading(true);
      setLoadErr("");

      try {
        const r = await fetch(`${API_BASE}/api/master-save/latest/${projectId}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (cancelled) return;

        setSnapshot(j.snapshot || null);

        const project = j?.snapshot?.project || {};
        const catalogSongs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
        const albumSongTitles = Array.isArray(project?.album?.songTitles) ? project.album.songTitles : [];
        const playlistOrder = Array.isArray(project?.album?.playlistOrder) ? project.album.playlistOrder : null;

        // Determine ordered slots from album.playlistOrder (slot-#), fallback 1..9
        const slots =
          Array.isArray(playlistOrder) && playlistOrder.length
            ? playlistOrder
                .map((id) => {
                  const m = String(id).match(/^slot-(\d+)$/);
                  return m ? Number(m[1]) : null;
                })
                .filter((n) => Number.isFinite(n) && n >= 1 && n <= SONG_COUNT)
            : Array.from({ length: SONG_COUNT }).map((_, i) => i + 1);

        // Build titles by slot: Album title -> Catalog title -> "Song #"
        const nextTitles = {};
        for (const slot of Array.from({ length: SONG_COUNT }).map((_, i) => i + 1)) {
          const a = albumSongTitles.find((x) => Number(x.slot) === Number(slot));
          const c = catalogSongs.find((x) => Number(x.songNumber) === Number(slot));

          const title = String(a?.title || c?.title || "").trim() || `Song ${slot}`;

          // Prefer titleJson from catalog if present; otherwise synthesize from title
          const titleJson =
            c?.titleJson && typeof c.titleJson === "object"
              ? {
                  slot: Number(c.titleJson.slot ?? slot),
                  title: String(c.titleJson.title ?? title),
                  updatedAt: String(c.titleJson.updatedAt || ""),
                  source: String(c.titleJson.source || "catalog"),
                }
              : ensureTitleJson(slot, title, a?.title ? "album" : "catalog");

          nextTitles[slot] = { title, titleJson };
        }

        if (cancelled) return;
        setOrderedSlots(slots);
        setTitlesBySlot(nextTitles);

        // If snapshot already has meta.songs, merge into local draft (without wiping local edits)
        const snapMetaSongs = Array.isArray(project?.meta?.songs) ? project.meta.songs : null;
        if (snapMetaSongs && snapMetaSongs.length) {
          setMetaBySlot((prev) => mergeSnapshotMeta(prev, snapMetaSongs));
        }
      } catch (e) {
        if (!cancelled) setLoadErr(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [API_BASE, projectId]);

  /* ---------------- helpers for editing ---------------- */

  const setLyrics = (slot, lyrics) => {
    setMetaBySlot((prev) => ({
      ...prev,
      [slot]: {
        ...(prev[slot] || emptyMetaSlot(slot)),
        lyrics: String(lyrics ?? ""),
      },
    }));
  };

  const setCredit = (slot, groupKey, idx, value) => {
    setMetaBySlot((prev) => {
      const cur = prev[slot] || emptyMetaSlot(slot);
      const list = Array.isArray(cur.credits?.[groupKey]) ? [...cur.credits[groupKey]] : [""];
      list[idx] = String(value ?? "");
      return {
        ...prev,
        [slot]: {
          ...cur,
          credits: { ...(cur.credits || {}), [groupKey]: list },
        },
      };
    });
  };

  const addCreditRow = (slot, groupKey) => {
    setMetaBySlot((prev) => {
      const cur = prev[slot] || emptyMetaSlot(slot);
      const list = Array.isArray(cur.credits?.[groupKey]) ? [...cur.credits[groupKey]] : [];
      list.push("");
      return {
        ...prev,
        [slot]: {
          ...cur,
          credits: { ...(cur.credits || {}), [groupKey]: list.length ? list : [""] },
        },
      };
    });
  };

  const removeCreditRow = (slot, groupKey, idx) => {
    setMetaBySlot((prev) => {
      const cur = prev[slot] || emptyMetaSlot(slot);
      const list = Array.isArray(cur.credits?.[groupKey]) ? [...cur.credits[groupKey]] : [];
      list.splice(idx, 1);
      if (list.length === 0) list.push("");
      return {
        ...prev,
        [slot]: {
          ...cur,
          credits: { ...(cur.credits || {}), [groupKey]: list },
        },
      };
    });
  };

  /* ---------------- Master Save ---------------- */

  const buildMetaSongsPayload = () => {
    const slots = Array.from({ length: SONG_COUNT }).map((_, i) => i + 1);
    return slots.map((slot) => {
      const titlePack =
        titlesBySlot[slot] || {
          title: `Song ${slot}`,
          titleJson: ensureTitleJson(slot, `Song ${slot}`, "catalog"),
        };
      const cur = metaBySlot[slot] || emptyMetaSlot(slot);

      return {
        slot,
        titleJson: titlePack.titleJson,
        credits: normalizeCredits(cur.credits),
        lyrics: String(cur.lyrics || ""),
      };
    });
  };

  const handleMasterSave = async () => {
    if (!API_BASE) return window.alert("Missing VITE_BACKEND_URL in .env.local");
    if (!projectId) return;

    const first = window.confirm("Are you sure you want to perform a Master Save from Meta?\n\nThis saves credits + lyrics (song-level).");
    if (!first) return;

    const second = window.confirm("Last chance.\n\nMake sure everything is complete before continuing.");
    if (!second) return;

    try {
      // Pull latest snapshot, patch meta.songs, then master-save back
      const r1 = await fetch(`${API_BASE}/api/master-save/latest/${projectId}`);
      const j1 = await r1.json().catch(() => ({}));
      if (!r1.ok || !j1?.ok) throw new Error(j1?.error || `HTTP ${r1.status}`);

      const currentProject = j1?.snapshot?.project || {};
      const metaSongs = buildMetaSongsPayload();

      const nextProject = {
        ...currentProject,
        meta: {
          ...(currentProject.meta || {}),
          songs: metaSongs,
        },
      };

      const r2 = await fetch(`${API_BASE}/api/master-save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, project: nextProject }),
      });
      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok || !j2?.ok) throw new Error(j2?.error || `HTTP ${r2.status}`);

      window.alert("Meta Master Save complete.\n\nCredits + lyrics saved into snapshot.");
    } catch (e) {
      window.alert(`Master Save failed:\n\n${e?.message || String(e)}`);
    }
  };

  /* ---------------- render ---------------- */

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Small header */}
<div style={{ fontSize: 11, opacity: 0.75, marginBottom: 10 }}>
  Project ID: <code>{projectId}</code>
  {token ? (
    <>
      {" · "}
      Link: <code>{token.slice(0, 10)}…</code>
    </>
  ) : null}
  {" · "}
  <strong>Meta Build:</strong> <code>{META_BUILD_STAMP}</code>
  {" · "}
  <strong>App Build:</strong>{" "}
  <code>{import.meta.env.VITE_APP_BUILD_STAMP || "NO_APP_STAMP_ENV"}</code>
</div>

      {/* Title */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a" }}>Meta</div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            Song-level only. Order comes from <code>album.playlistOrder</code>. Titles come from Album (fallback Catalog).
          </div>
        </div>

        <div style={{ fontSize: 11, opacity: 0.7, textAlign: "right" }}>
          {loading ? <div>Loading latest snapshot…</div> : null}
          {snapshot?.savedAt ? (
            <div>
              Snapshot loaded: <code>{snapshot.savedAt}</code>
            </div>
          ) : (
            <div>Snapshot loaded: —</div>
          )}
        </div>
      </div>

      {loadErr ? (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "#991b1b",
            background: "#fee2e2",
            border: "1px solid #fecaca",
            padding: 10,
            borderRadius: 12,
          }}
        >
          {loadErr}
        </div>
      ) : null}

      {/* Song tables */}
      <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
        {orderedSlots.map((slot, idx) => {
          const titlePack =
            titlesBySlot[slot] || {
              title: `Song ${slot}`,
              titleJson: ensureTitleJson(slot, `Song ${slot}`, "catalog"),
            };
          const meta = metaBySlot[slot] || emptyMetaSlot(slot);

          return (
            <div key={`${slot}-${idx}`} style={{ ...card(), padding: 14 }}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 950, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Song {slot} — {titlePack.title}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.65 }}>
                    Display order: <strong>{idx + 1}</strong> of {orderedSlots.length || SONG_COUNT}
                  </div>
                </div>

                <div style={slotBadge()}>
                  <span style={{ opacity: 0.7 }}>slot</span> {slot}
                </div>
              </div>

              {/* Two cards */}
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {/* Left: Credits */}
                <div style={{ ...subCard() }}>
                  <div style={sectionTitle()}>Credits</div>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
                    Add or remove names. Empty fields are OK. Empty groups won’t show on album credits later.
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                    <CreditGroup
                      label="Songwriter"
                      values={meta.credits.songwriter}
                      onChange={(i, v) => setCredit(slot, "songwriter", i, v)}
                      onAdd={() => addCreditRow(slot, "songwriter")}
                      onRemove={(i) => removeCreditRow(slot, "songwriter", i)}
                    />

                    <CreditGroup
                      label="Performer"
                      values={meta.credits.performer}
                      onChange={(i, v) => setCredit(slot, "performer", i, v)}
                      onAdd={() => addCreditRow(slot, "performer")}
                      onRemove={(i) => removeCreditRow(slot, "performer", i)}
                    />

                    <CreditGroup
                      label="Engineer"
                      values={meta.credits.engineer}
                      onChange={(i, v) => setCredit(slot, "engineer", i, v)}
                      onAdd={() => addCreditRow(slot, "engineer")}
                      onRemove={(i) => removeCreditRow(slot, "engineer", i)}
                    />

                    {/* IMPORTANT: singular "Producer" */}
                    <CreditGroup
                      label="Producer"
                      values={meta.credits.producer}
                      onChange={(i, v) => setCredit(slot, "producer", i, v)}
                      onAdd={() => addCreditRow(slot, "producer")}
                      onRemove={(i) => removeCreditRow(slot, "producer", i)}
                    />
                  </div>
                </div>

                {/* Right: Lyrics */}
                <div style={{ ...subCard() }}>
                  <div style={sectionTitle()}>Lyrics</div>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
                    Paste or type lyrics. Empty is OK.
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <textarea
                      value={meta.lyrics}
                      onChange={(e) => setLyrics(slot, e.target.value)}
                      placeholder="Paste lyrics here…"
                      style={lyricsBox()}
                      spellCheck={false}
                    />
                    <div style={{ marginTop: 8, fontSize: 11, opacity: 0.65 }}>
                      {meta.lyrics?.trim()?.length ? (
                        <span>
                          Characters: <strong>{meta.lyrics.trim().length}</strong>
                        </span>
                      ) : (
                        <span>Characters: —</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Master Save */}
      <div style={{ marginTop: 14, ...card() }}>
        <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
          <strong>Master Save</strong> writes <code>meta.songs</code> into the snapshot (credits + lyrics, song-level).
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

/* ---------------- components ---------------- */

function CreditGroup({ label, values, onChange, onAdd, onRemove }) {
  const list = Array.isArray(values) && values.length ? values : [""];

  return (
    <div>
      <div style={miniLabel()}>{label}</div>

      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
        {list.map((v, i) => (
          <div key={`${label}-${i}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={String(v ?? "")} onChange={(e) => onChange(i, e.target.value)} style={input()} />
            <button type="button" onClick={() => onRemove(i)} style={minusBtn()} title="Remove">
              –
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={onAdd} style={plusBtn()}>
          + Add name
        </button>
      </div>
    </div>
  );
}

/* ---------------- API helpers ---------------- */

function ensureTitleJson(slot, title, source) {
  const now = new Date().toISOString();
  return {
    slot: Number(slot),
    title: String(title || ""),
    updatedAt: now,
    source: String(source || "catalog"),
  };
}

/* ---------------- local storage ---------------- */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeJSON(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {}
}

/* ---------------- normalize / merge ---------------- */

function emptyMetaSlot(slot) {
  return {
    slot: Number(slot),
    credits: {
      songwriter: [""],
      performer: [""],
      engineer: [""],
      producer: [""],
    },
    lyrics: "",
  };
}

function normalizeCredits(credits) {
  const c = credits && typeof credits === "object" ? credits : {};
  const norm = (arr) => {
    if (!Array.isArray(arr)) return [""];
    return arr.length ? arr.map((x) => String(x ?? "")) : [""];
  };
  return {
    songwriter: norm(c.songwriter),
    performer: norm(c.performer),
    engineer: norm(c.engineer),
    producer: norm(c.producer),
  };
}

function normalizeMetaBySlot(input) {
  const out = {};
  for (let slot = 1; slot <= SONG_COUNT; slot++) {
    const cur = input?.[slot] && typeof input[slot] === "object" ? input[slot] : {};
    out[slot] = {
      slot,
      credits: normalizeCredits(cur.credits),
      lyrics: String(cur.lyrics ?? ""),
    };
  }
  return out;
}

function mergeSnapshotMeta(prevBySlot, snapSongs) {
  // Merge snapshot meta into local draft ONLY when local fields are empty.
  const next = { ...(prevBySlot || {}) };

  for (const row of snapSongs) {
    const slot = Number(row?.slot);
    if (!Number.isFinite(slot) || slot < 1 || slot > SONG_COUNT) continue;

    const prev = next[slot] || emptyMetaSlot(slot);

    const snapCredits = normalizeCredits(row?.credits);
    const snapLyrics = String(row?.lyrics ?? "");

    const mergedCredits = { ...prev.credits };
    for (const k of ["songwriter", "performer", "engineer", "producer"]) {
      const prevList = Array.isArray(prev.credits?.[k]) ? prev.credits[k] : [""];
      const prevHasAny = prevList.some((x) => String(x || "").trim().length > 0);
      mergedCredits[k] = prevHasAny ? prevList : snapCredits[k];
    }

    const mergedLyrics = prev.lyrics?.trim()?.length ? prev.lyrics : snapLyrics;

    next[slot] = {
      ...prev,
      credits: mergedCredits,
      lyrics: mergedLyrics,
    };
  }

  return normalizeMetaBySlot(next);
}

/* ---------------- styles ---------------- */

function card() {
  return { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 };
}
function subCard() {
  return { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 };
}
function sectionTitle() {
  return { fontSize: 12, fontWeight: 900, letterSpacing: 0.2, textTransform: "uppercase" };
}
function miniLabel() {
  return { fontSize: 11, fontWeight: 900, opacity: 0.65, textTransform: "uppercase" };
}
function input() {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontSize: 13,
    outline: "none",
  };
}
function lyricsBox() {
  return {
    width: "100%",
    minHeight: 220,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontSize: 13,
    outline: "none",
    resize: "vertical",
    lineHeight: 1.5,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
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
function plusBtn() {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #a7f3d0",
    background: "#d1fae5",
    color: "#065f46",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  };
}
function minusBtn() {
  return {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: "1px solid #fecaca",
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: 16,
    fontWeight: 900,
    cursor: "pointer",
    flex: "0 0 auto",
    lineHeight: 1,
  };
}
function slotBadge() {
  return {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#f8fafc",
    fontSize: 11,
    fontWeight: 900,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    color: "#111827",
    whiteSpace: "nowrap",
  };
}
/* BUILD STAMP — MUST APPEAR IN UI */
const META_BUILD_STAMP = "STAMP-META-FORCE-RENDER-2026-01-10-E";
