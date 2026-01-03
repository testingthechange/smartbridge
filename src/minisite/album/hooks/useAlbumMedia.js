// src/minisite/album/hooks/useAlbumMedia.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readJSON, readText, writeJSON, writeText } from "../albumStorage";
import { idbDelete, idbGetBlob, idbSetBlob } from "../albumIdb";
import { safeRevoke, uid } from "../meta/albumMeta.utils";
import { sanitizeFileName, uploadToS3 } from "../utils/mediaUpload";

/**
 * Owns Album "media" (cover + slideshow)
 * - Local preview via IndexedDB
 * - Portable storage via S3 keys (best-effort for slideshow)
 */
export function useAlbumMedia({
  projectId,
  API_BASE,
  albumInfoLocked,
  storageKey,
  SLIDESHOW_MAX,
}) {
  /* ---------------- Cover ---------------- */

  const coverKey = useMemo(
    () => `albumCover:${String(projectId || "no-project")}`,
    [projectId]
  );

  const [coverFileName, setCoverFileName] = useState(() =>
    readText(storageKey("coverFileName"), "")
  );
  const [coverStoreKey, setCoverStoreKey] = useState(() =>
    readText(storageKey("coverStoreKey"), "")
  );
  const [coverMime, setCoverMime] = useState(() =>
    readText(storageKey("coverMime"), "")
  );
  const [coverBytes, setCoverBytes] = useState(
    () => Number(readText(storageKey("coverBytes"), "0")) || 0
  );

  // portable pointer
  const [coverS3Key, setCoverS3Key] = useState(() =>
    readText(storageKey("coverS3Key"), "")
  );

  useEffect(() => writeText(storageKey("coverFileName"), coverFileName), [coverFileName, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("coverStoreKey"), coverStoreKey), [coverStoreKey, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("coverMime"), coverMime), [coverMime, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("coverBytes"), String(coverBytes || 0)), [coverBytes, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("coverS3Key"), coverS3Key), [coverS3Key, projectId]); // eslint-disable-line

  const coverUrlRef = useRef("");
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");

  const revokeCoverUrl = () => {
    safeRevoke(coverUrlRef.current);
    coverUrlRef.current = "";
  };

  const hydrateCoverPreview = useCallback(async () => {
    revokeCoverUrl();
    setCoverPreviewUrl("");

    const key = coverStoreKey || coverKey;
    if (!key) return;

    const blob = await idbGetBlob(key);
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    coverUrlRef.current = url;
    setCoverPreviewUrl(url);
  }, [coverKey, coverStoreKey]);

  useEffect(() => {
    hydrateCoverPreview();
    return () => revokeCoverUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, coverStoreKey]);

  const pickCover = useCallback(
    async (file) => {
      if (!file) return;
      if (albumInfoLocked) return;
      if (!projectId) return;

      try {
        // local preview
        await idbSetBlob(coverKey, file);

        setCoverFileName(String(file.name || ""));
        setCoverStoreKey(coverKey);
        setCoverMime(String(file.type || ""));
        setCoverBytes(Number(file.size || 0));

        // instant preview
        revokeCoverUrl();
        const url = URL.createObjectURL(file);
        coverUrlRef.current = url;
        setCoverPreviewUrl(url);

        // portable upload
        if (!API_BASE) return;

        const safeName = sanitizeFileName(file.name || "cover.jpg");
        const ts = Date.now();
        const s3Key = `storage/projects/${projectId}/album/cover/${ts}_${safeName}`;

        await uploadToS3(API_BASE, file, s3Key);
        setCoverS3Key(s3Key);
      } catch (e) {
        window.alert(`Cover save failed:\n\n${e?.message || String(e)}`);
      }
    },
    [API_BASE, albumInfoLocked, coverKey, projectId]
  );

  /* ---------------- Slideshow ---------------- */

  // shape: [{ id, fileName, mime, bytes, storeKey, s3Key }]
  const [slideshowItems, setSlideshowItems] = useState(() => {
    const saved = readJSON(storageKey("slideshowItems"), null);
    if (!Array.isArray(saved)) return [];
    return saved
      .map((x) => ({
        id: String(x?.id || ""),
        fileName: String(x?.fileName || ""),
        mime: String(x?.mime || ""),
        bytes: Number(x?.bytes || 0) || 0,
        storeKey: String(x?.storeKey || ""),
        s3Key: String(x?.s3Key || ""),
      }))
      .filter((x) => x.id && x.storeKey);
  });

  useEffect(() => writeJSON(storageKey("slideshowItems"), slideshowItems), [slideshowItems, projectId]); // eslint-disable-line

  const addSlideshowFiles = useCallback(
    async (files) => {
      if (albumInfoLocked) return;
      if (!projectId) return;

      const list = Array.from(files || []).filter(Boolean);
      if (!list.length) return;

      const remaining = Math.max(0, SLIDESHOW_MAX - slideshowItems.length);
      if (remaining <= 0) return;

      const toAdd = list.slice(0, remaining);

      try {
        const newRows = [];
        for (const f of toAdd) {
          const id = uid();
          const storeKey = `albumSlide:${String(projectId || "no-project")}:${id}`;

          // local preview
          await idbSetBlob(storeKey, f);

          const row = {
            id,
            fileName: String(f.name || ""),
            mime: String(f.type || ""),
            bytes: Number(f.size || 0) || 0,
            storeKey,
            s3Key: "",
          };

          // best effort upload
          if (API_BASE) {
            try {
              const safeName = sanitizeFileName(f.name || "slide");
              const s3Key = `storage/projects/${projectId}/album/slideshow/${id}_${safeName}`;
              await uploadToS3(API_BASE, f, s3Key);
              row.s3Key = s3Key;
            } catch (e) {
              console.warn("slideshow upload failed:", e);
            }
          }

          newRows.push(row);
        }

        setSlideshowItems((prev) => [...(prev || []), ...newRows]);
      } catch (e) {
        window.alert(`Slideshow save failed:\n\n${e?.message || String(e)}`);
      }
    },
    [API_BASE, SLIDESHOW_MAX, albumInfoLocked, projectId, slideshowItems.length]
  );

  const removeSlideshowItem = useCallback(
    async (id) => {
      setSlideshowItems((prev) => (prev || []).filter((x) => x.id !== id));
      try {
        const row = slideshowItems.find((x) => x.id === id);
        if (row?.storeKey) await idbDelete(row.storeKey);
      } catch {}
    },
    [slideshowItems]
  );

  return {
    // cover
    coverKey,
    coverStoreKey,
    coverFileName,
    coverMime,
    coverBytes,
    coverS3Key,
    coverPreviewUrl,
    pickCover,

    // slideshow
    slideshowItems,
    addSlideshowFiles,
    removeSlideshowItem,
  };
}
