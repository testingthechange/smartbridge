import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const S3_BASE = "https://block-7306-player.s3.us-west-1.amazonaws.com";

function fmtTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

async function fetchManifest(shareId) {
  const url = `${S3_BASE}/public/players/${shareId}/manifest.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  return res.json();
}

export default function Product() {
  const { shareId } = useParams();
  const audioRef = useRef(null);

  const [manifest, setManifest] = useState(null);
  const [activeSlot, setActiveSlot] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setErr("");
    setManifest(null);
    setActiveSlot(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    fetchManifest(shareId)
      .then((m) => {
        if (!alive) return;
        setManifest(m);
        const first = Array.isArray(m?.tracks) ? m.tracks.find((t) => t?.playbackUrl) : null;
        setActiveSlot(first?.slot ?? null);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(String(e?.message || e));
      });

    return () => {
      alive = false;
    };
  }, [shareId]);

  const activeTrack = useMemo(() => {
    if (!manifest?.tracks?.length) return null;
    return manifest.tracks.find((t) => Number(t?.slot) === Number(activeSlot)) || null;
  }, [manifest, activeSlot]);

  // Keep audio element state in sync
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    a.muted = !!isMuted;
    a.volume = Math.min(1, Math.max(0, Number(volume) || 0));
  }, [isMuted, volume]);

  // Wire audio events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(a.currentTime || 0);
    const onLoaded = () => setDuration(a.duration || 0);
    const onEnded = () => setIsPlaying(false);

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("ended", onEnded);
    };
  }, []);

  const ensureSource = async (track) => {
    const a = audioRef.current;
    if (!a || !track?.playbackUrl) return;

    // Only swap src if different
    if (a.getAttribute("src") !== track.playbackUrl) {
      a.src = track.playbackUrl;
      a.load();
      setCurrentTime(0);
      setDuration(0);
    }
  };

  const handleSelectTrack = async (slot) => {
    setActiveSlot(slot);
    const t =
      manifest?.tracks?.find((x) => Number(x?.slot) === Number(slot)) || null;
    await ensureSource(t);

    // If already playing, continue with new track
    const a = audioRef.current;
    if (a && isPlaying) {
      try {
        await a.play();
      } catch {
        // ignore autoplay restrictions; user can hit play
      }
    }
  };

  const handleTogglePlay = async () => {
    const a = audioRef.current;
    if (!a) return;

    const t = activeTrack;
    if (!t?.playbackUrl) return;

    await ensureSource(t);

    if (a.paused) {
      try {
        await a.play();
      } catch (e) {
        setErr(String(e?.message || e));
      }
    } else {
      a.pause();
    }
  };

  const handleSeek = (next) => {
    const a = audioRef.current;
    if (!a) return;
    const v = Math.min(duration || 0, Math.max(0, Number(next) || 0));
    a.currentTime = v;
    setCurrentTime(v);
  };

  const albumMeta = manifest?.meta || {};
  const albumTitle = albumMeta?.albumTitle || manifest?.albumTitle || "Album";
  const artistName = albumMeta?.artistName || "";
  const releaseDate = albumMeta?.releaseDate || "";

  return (
    <div className="max-w-[1100px] mx-auto px-4">
      {/* Header (keep your existing header structure if you have one) */}
      <div className="py-6">
        <div className="text-xl font-semibold">{albumTitle}</div>
        {artistName ? <div className="text-sm opacity-80">{artistName}</div> : null}
      </div>

      {err ? (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-sm">
          {err}
        </div>
      ) : null}

      {/* Root layout: two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* COLUMN ONE */}
        <div className="space-y-6">
          {/* Cover */}
          <div className="rounded-2xl border p-4">
            <div className="aspect-square w-full overflow-hidden rounded-xl bg-gray-100">
              {manifest?.coverUrl ? (
                <img
                  src={manifest.coverUrl}
                  alt="cover"
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm opacity-70">
                  No cover
                </div>
              )}
            </div>
          </div>

          {/* Track list */}
          <div className="rounded-2xl border p-4">
            <div className="text-sm font-medium mb-3">Tracks</div>
            <div className="space-y-2">
              {(manifest?.tracks || []).map((t) => {
                const slot = Number(t?.slot) || 0;
                const active = slot && Number(activeSlot) === slot;
                return (
                  <button
                    key={slot || crypto.randomUUID?.() || String(Math.random())}
                    type="button"
                    onClick={() => handleSelectTrack(slot)}
                    className={`w-full text-left px-3 py-2 rounded-lg border ${
                      active ? "border-black" : "border-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm">
                        <span className="opacity-60 mr-2">{slot}.</span>
                        {t?.title || `Track ${slot}`}
                      </div>
                      <div className="text-xs opacity-60">
                        {t?.durationSec ? fmtTime(t.durationSec) : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
              {!manifest?.tracks?.length ? (
                <div className="text-sm opacity-70">No tracks</div>
              ) : null}
            </div>
          </div>
        </div>

        {/* COLUMN TWO */}
        <div className="space-y-6">
          {/* Album Info card MUST be at top of column two */}
          <div className="rounded-2xl border p-4">
            <div className="text-sm font-medium mb-3">Album Info</div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="opacity-60">Album name</div>
                <div className="text-right">{albumTitle}</div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="opacity-60">Performer</div>
                <div className="text-right">{artistName || "—"}</div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="opacity-60">Release date</div>
                <div className="text-right">{releaseDate || "—"}</div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="opacity-60">Total album time</div>
                <div className="text-right">—</div>
              </div>
            </div>
          </div>

          {/* Player card (sound + play turned back on) */}
          <div className="rounded-2xl border p-4">
            <div className="text-sm font-medium mb-3">Player</div>

            {/* Real audio element (do not remove) */}
            <audio ref={audioRef} data-audio="product" />

            <div className="space-y-3">
              <div className="text-sm">
                <div className="opacity-60 text-xs mb-1">Now playing</div>
                <div className="font-medium">
                  {activeTrack?.title
                    ? `${activeTrack.slot}. ${activeTrack.title}`
                    : "—"}
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  disabled={!activeTrack?.playbackUrl}
                  className="px-3 py-2 rounded-lg border border-gray-200 disabled:opacity-50"
                >
                  {isPlaying ? "Pause" : "Play"}
                </button>

                <button
                  type="button"
                  onClick={() => setIsMuted((m) => !m)}
                  className="px-3 py-2 rounded-lg border border-gray-200"
                >
                  {isMuted ? "Unmute" : "Mute"}
                </button>

                <div className="flex items-center gap-2 ml-auto">
                  <div className="text-xs opacity-60">Vol</div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Scrubber */}
              <div className="space-y-1">
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, duration || 0)}
                  step="0.01"
                  value={Math.min(currentTime || 0, duration || 0)}
                  onChange={(e) => handleSeek(e.target.value)}
                  disabled={!activeTrack?.playbackUrl}
                  className="w-full"
                />
                <div className="flex items-center justify-between text-xs opacity-60">
                  <div>{fmtTime(currentTime)}</div>
                  <div>{duration ? fmtTime(duration) : "0:00"}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Keep space for your existing cards (purchase, CTA, etc.) */}
          <div className="rounded-2xl border p-4">
            <div className="text-sm font-medium mb-2">Actions</div>
            <div className="text-sm opacity-70">
              (Keep your existing buy/cta UI here.)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
