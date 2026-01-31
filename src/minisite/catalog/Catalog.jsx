// FILE: src/minisite/catalog/Catalog.jsx
import React, { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { getApiBase, uploadSongFile, fetchPlaybackUrl } from "./catalogCore.js";

export default function Catalog() {
  const { projectId: projectIdParam } = useParams();
  const projectId = String(projectIdParam || "demo");

  const { search } = useLocation();
  const qs = new URLSearchParams(search);
  const token = qs.get("token") || "";

  const audioRef = useRef(null);

  const [fileName, setFileName] = useState("");
  const [s3Key, setS3Key] = useState(
    () => localStorage.getItem("catalog_test_s3Key") || ""
  );
  const [status, setStatus] = useState("");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.removeAttribute("src");
    try { a.load(); } catch {}
  }, []);

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("Uploading…");
    setFileName(file.name);

    try {
      const apiBase = getApiBase();
      const res = await uploadSongFile({
        apiBase,
        projectId,
        slot: 1,
        versionKey: "album",
        file,
        token,
      });

      if (!res?.s3Key) throw new Error("No s3Key returned");

      localStorage.setItem("catalog_test_s3Key", res.s3Key);
      setS3Key(res.s3Key);
      setStatus("Upload OK");
    } catch (err) {
      setStatus(err.message || "Upload failed");
    }
  }

  async function onPlay() {
    if (!s3Key) {
      setStatus("No s3Key saved");
      return;
    }

    try {
      const apiBase = getApiBase();
      const url = await fetchPlaybackUrl({ apiBase, s3Key, token });
      if (!url) throw new Error("No playback URL");

      const a = audioRef.current;
      a.pause();
      a.removeAttribute("src");
      try { a.load(); } catch {}

      a.src = url;
      a.currentTime = 0;
      await a.play();
      setPlaying(true);
      setStatus("Playing");
    } catch (err) {
      setPlaying(false);
      setStatus(err.message || "Playback failed");
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h2>Catalog – Minimal Test</h2>

      <input type="file" onChange={onUpload} />

      <div style={{ marginTop: 10 }}>
        <button onClick={onPlay} disabled={!s3Key}>
          Play
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 12 }}>
        <div>File: {fileName || "—"}</div>
        <div>s3Key: {s3Key || "—"}</div>
        <div>Status: {status}</div>
      </div>

      <audio ref={audioRef} />
    </div>
  );
}
