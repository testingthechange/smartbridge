import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

/**
 * Product page (preview)
 * FIXES:
 * 1) NO local/global header rendered here (prevents double header if your AppShell already renders it)
 * 2) Cover image fills the entire left card
 * 3) Album Info card is the FIRST card in the right column
 * 4) Sound/play restored via a real <audio data-audio="product"> element wired to buttons
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
  const audioRef = useRef(null);

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

  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const tracks = useMemo(() => {
    const t = Array.isArray(manifest?.tracks) ? manifest.tracks : [];
    return t
      .map((x) => ({
        slot: Number(x?.slot || 0),
        title: String(x?.title || "").trim() || `Track ${Number(x?.slot || 0)}`,
        playbackUrl: String(x?.playbackUrl || "").trim(),
        durationSec: Number(x?.durationSec || 0),
      }))
      .filter((x) => x.slot > 0 && x.playbackUrl)
      .sort((a, b) => (a.slot || 0) - (b.slot || 0));
  }, [manifest]);

  const activeTrack = tracks[activeIndex] || null;

  const albumTitle = String(manifest?.meta?.albumTitle || manifest?.albumTitle || "Album");
  const artistName = String(manifest?.meta?.artistName || "");
  const releaseDate = String(manifest?.meta?.releaseDate || "");

  const coverUrl = useMemo(() => {
    const u = String(manifest?.coverUrl || "").trim();
    return u || fallbackCoverUrl;
  }, [manifest, fallbackCoverUrl]);

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
        const r = await fetch(manifestUrl, { cache: "no-store" });
        if (!r.ok) throw new Error(`MANIFEST_HTTP_${r.status}`);
        const j = await r.json();
        if (!j || typeof j !== "object") throw new Error("MANIFEST_INVALID");
        if (!cancelled) setManifest(j);
      } catch (e) {
        if (!cancelled) setErr(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [manifestUrl]);

  // Sync audio element (volume/mute)
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.muted = !!isMuted;
    a.volume = Math.min(1, Math.max(0, Number(volume) || 0));
  }, [isMuted, volume]);

  // Attach audio events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(a.currentTime || 0);
    const onMeta = () => setDuration(a.duration || 0);
    const onEnded = () => setIsPlaying(false);

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
  }, []);

  function ensureSrc(track) {
    const a = audioRef.current;
    if (!a) return;

    const src = String(track?.playbackUrl || "").trim();
    if (!src) return;

    const prev = a.getAttribute("src") || "";
    if (prev !== src) {
      a.setAttribute("src", src);
      a.load();
      setCurrentTime(0);
      setDuration(0);
    }
  }

  async function handlePlayPause() {
    const a = audioRef.current;
    if (!a) return;

    const t = activeTrack || tracks[0] || null;
    if (!t) return;

    ensureSrc(t);

    if (a.paused) {
      try {
        await a.play(); // requires user gesture; this is a button click
      } catch {
        setIsPlaying(false);
      }
    } else {
      a.pause();
    }
  }

  function handleSelect(idx) {
    setActiveIndex(idx);
    const t = tracks[idx];
    if (!t) return;
    ensureSrc(t);

    // If already playing, continue on the new track
    const a = audioRef.current;
    if (a && !a.paused) {
      a.play().catch(() => {});
    }
  }

  function handleSeek(next) {
    const a = audioRef.current;
    if (!a) return;
    const v = Number(next);
    if (!Number.isFinite(v)) return;
    a.currentTime = v;
    setCurrentTime(v);
  }

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto px-4 py-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm opacity-70">
          Loading…
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="max-w-[1200px] mx-auto px-4 py-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="font-semibold mb-2">Product failed</div>
          <div className="text-sm opacity-70 break-all">{err}</div>
          <div className="text-xs opacity-60 break-all mt-3">manifest: {manifestUrl}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 pb-28">
      {/* IMPORTANT: DO NOT render any header/nav here. That lives in the global layout. */}

      <h1 className="text-4xl font-bold mb-6">{albumTitle}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN (cover + tracks) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold mb-3">Album</div>

            {/* Enlarged cover: fill whole card width; tall fixed area */}
            <div className="w-full h-[520px] rounded-xl overflow-hidden border border-white/10 bg-black/20">
              <img
                src={coverUrl}
                alt={`${albumTitle} cover`}
                className="w-full h-full object-cover block"
                onError={(e) => {
                  if (fallbackCoverUrl && e.currentTarget.src !== fallbackCoverUrl) {
                    e.currentTarget.src = fallbackCoverUrl;
                  }
                }}
                draggable={false}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold mb-3">Tracks</div>

            <div className="space-y-2">
              {tracks.length ? (
                tracks.map((t, idx) => {
                  const active = idx === activeIndex;
                  return (
                    <button
                      key={`${t.slot}-${idx}`}
                      type="button"
                      onClick={() => handleSelect(idx)}
                      className={`w-full text-left rounded-xl border px-3 py-2 ${
                        active
                          ? "border-white/30 bg-white/10"
                          : "border-white/10 bg-white/5"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate font-semibold">
                          <span className="opacity-70 mr-2">{t.slot}.</span>
                          {t.title}
                        </div>
                        <div className="text-xs opacity-60">
                          {t.durationSec ? fmtTime(t.durationSec) : ""}
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="text-sm opacity-70">No playable tracks found.</div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (Album Info must be top) */}
        <div className="lg:col-span-1 space-y-6">
          {/* Album Info at TOP */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold mb-3">Album Info</div>

            <div className="text-xs opacity-60">Album name</div>
            <div className="font-semibold mb-3">{albumTitle}</div>

            <div className="text-xs opacity-60">Performer</div>
            <div className="font-semibold mb-3">{artistName || "—"}</div>

            <div className="text-xs opacity-60">Release date</div>
            <div className="font-semibold">{releaseDate || "—"}</div>
          </div>

          <button className="w-full rounded-2xl border border-white/10 bg-emerald-400/90 text-black font-semibold py-3">
            Buy — $19.50
          </button>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold mb-3">What you get</div>
            <ul className="text-sm opacity-80 list-disc pl-5 space-y-1">
              <li>8 songs</li>
              <li>Smart bridge mode</li>
              <li>Album mode</li>
              <li>Artist control</li>
              <li>Over 60 minutes of bonus authored bridge content</li>
              <li>FREE MP3 album mix download included</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom player (sound + play restored) */}
      <div className="fixed left-0 right-0 bottom-0 border-t border-white/10 bg-black/70 backdrop-blur px-4 py-3">
        <div className="max-w-[1200px] mx-auto flex items-center gap-4">
          {/* REAL AUDIO ELEMENT. Do not remove; other parts of app may query [data-audio="product"] */}
          <audio ref={audioRef} data-audio="product" preload="metadata" />

          <button
            type="button"
            onClick={handlePlayPause}
            className="h-10 w-10 rounded-full border border-white/20 bg-white/10 font-black"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>

          <div className="flex-1 min-w-0">
            <div className="text-xs opacity-70 text-center">Now Playing</div>
            <div className="truncate font-semibold text-center">
              {activeTrack ? `${activeTrack.slot}. ${activeTrack.title}` : "—"}
            </div>

            <div className="flex items-center gap-3 mt-2">
              <div className="text-xs opacity-70 w-10 text-right">
                {fmtTime(currentTime)}
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, duration || 0)}
                step={0.25}
                value={Math.min(Math.max(0, currentTime), Math.max(0, duration || 0))}
                onChange={(e) => handleSeek(e.target.value)}
                className="flex-1"
              />
              <div className="text-xs opacity-70 w-10">
                {duration ? fmtTime(duration) : "—"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsMuted((m) => !m)}
              className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold"
            >
              {isMuted ? "Unmute" : "Mute"}
            </button>

            <div className="hidden sm:flex items-center gap-2">
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
        </div>
      </div>
    </div>
  );
}
