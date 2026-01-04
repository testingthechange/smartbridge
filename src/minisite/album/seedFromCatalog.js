// src/minisite/album/seedFromCatalog.js

function normSlot(n, fallback) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? x : fallback;
}

function normTitle(s) {
  return String(s || "").trim();
}

function pickCatalogSongBySlot(catalogSongs, slot) {
  return (
    catalogSongs.find((x) => Number(x?.slot) === Number(slot)) ||
    catalogSongs.find((x) => Number(x?.songNumber) === Number(slot)) ||
    null
  );
}

/**
 * Seeds/patches project.album.songs using project.catalog.songs:
 * - title from catalog.title if album title missing
 * - file.s3Key from catalog.files.album.s3Key if album missing
 * Preserves existing album order if present.
 */
export function seedAlbumFromCatalog(project, songCount = 16) {
  const p = project && typeof project === "object" ? project : {};
  const catalogSongs = Array.isArray(p?.catalog?.songs) ? p.catalog.songs : [];
  const existingAlbumSongs = Array.isArray(p?.album?.songs) ? p.album.songs : [];

  // Build a target list of slots 1..songCount
  const slots = Array.from({ length: songCount }).map((_, i) => i + 1);

  // If album exists, patch it in-place (keep order)
  if (existingAlbumSongs.length) {
    const patched = existingAlbumSongs.map((row, idx) => {
      const slot = normSlot(row?.slot, idx + 1);
      const c = pickCatalogSongBySlot(catalogSongs, slot);

      const title = normTitle(row?.title) || normTitle(c?.title) || "";
      const s3Key =
        String(row?.file?.s3Key || "").trim() ||
        String(c?.files?.album?.s3Key || "").trim() ||
        "";

      return {
        ...row,
        slot,
        title,
        file: { ...(row?.file || {}), s3Key },
      };
    });

    return {
      ...p,
      album: {
        ...(p.album || {}),
        songs: patched,
      },
    };
  }

  // If album empty, seed from catalog by slot (1..songCount)
  const seeded = slots
    .map((slot) => {
      const c = pickCatalogSongBySlot(catalogSongs, slot);
      if (!c) return { slot, title: "", file: { s3Key: "" } };

      return {
        slot,
        title: normTitle(c?.title),
        file: { s3Key: String(c?.files?.album?.s3Key || "").trim() },
      };
    })
    .filter((r) => r.title || r.file?.s3Key); // keep only meaningful rows initially

  return {
    ...p,
    album: {
      ...(p.album || {}),
      songs: seeded,
    },
  };
}
