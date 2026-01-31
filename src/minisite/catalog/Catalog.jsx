import React, { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { getApiBase, uploadSongFile, fetchPlaybackUrl } from "./catalogCore.js";

export default function Catalog() {
  const { projectId } = useParams();
  const { search } = useLocation();
  const token = new URLSearchParams(search).get("token") || "";

  const audioRef = useRef(null);

  const [s3Key, setS3Key] = useState("");
  const [status, setStatus] = useState("idle");

  // HARD reset audio on mount
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

    setStatus("uploading");

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

      if (!res?.s3Key) throw new Error("NO_S3KEY");

      setS3Key(res.s3Key);
      localStorage.setItem("CATALOG_TEST_S3KEY", res.s3Key);
      setStatus("upload_ok");
    } catch (e) {
      setStatus("upload_failed");
    }
  }

  async function onPlay() {
    try {
      const key = s3Key || localStorage.getItem("CATALOG_TEST_S3KEY");
      if (!key) throw new Error("NO_KEY");

      const apiBase = getApiBase();
      const url = await fetchPlaybackUrl({ apiBase, s3Key: key, token });
      if (!url) throw new Error("NO_URL");

      const a = audioRef.current;
      a.pause();
      a.removeAttribute("src");
      try { a.load(); } catch {}

      a.src = url;
      a.currentTime = 0;
      await a.play();

      setStatus("playing");
    } catch {
      setStatus("play_failed");
    }
  }

  return (
    <div style={{ padding: 40 }}>
      <h2>CATALOG – MINIMAL TEST</h2>

      <input type="file" onChange={onUpload} />

      <div style={{ marginTop: 12 }}>
        <button onClick={onPlay}>PLAY</button>
      </div>

      <pre style={{ marginTop: 20 }}>
        status: {status}{"\n"}
        s3Key: {s3Key || "(from localStorage)"}
      </pre>

      <audio ref={audioRef} />
    </div>
  );
}
