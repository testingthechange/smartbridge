import React, { useRef, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { getApiBase, uploadSongFile, fetchPlaybackUrl } from "./catalogCore.js";

export default function Catalog() {
  const { projectId } = useParams();
  const qs = new URLSearchParams(useLocation().search);
  const token = qs.get("token") || "";

  const audioRef = useRef(null);
  const [s3Key, setS3Key] = useState("");
  const [status, setStatus] = useState("idle");

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("uploading");
    try {
      const res = await uploadSongFile({
        apiBase: getApiBase(),
        projectId,
        slot: 1,
        versionKey: "album",
        file,
        token,
      });
      setS3Key(res.s3Key);
      setStatus("uploaded");
    } catch (err) {
      setStatus("upload failed");
    }
  }

  async function play() {
    try {
      const url = await fetchPlaybackUrl({
        apiBase: getApiBase(),
        s3Key,
        token,
      });
      audioRef.current.src = url;
      await audioRef.current.play();
      setStatus("playing");
    } catch {
      setStatus("play failed");
    }
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>CATALOG MINIMAL TEST</h1>
      <input type="file" onChange={upload} />
      <br /><br />
      <button onClick={play} disabled={!s3Key}>Play</button>
      <p>Status: {status}</p>
      <audio ref={audioRef} />
    </div>
  );
}
