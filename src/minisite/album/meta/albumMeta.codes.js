// minisite/album/meta/albumMeta.codes.js
// Album-level meta "codes" (keys), labels, and optional field definitions.
// Keep this file pure constants (no React, no state).

export const ALBUM_META_CODES = Object.freeze({
  ALBUM_TITLE: 'album_title',
  ARTIST_NAME: 'artist_name',
  LABEL: 'label',
  UPC: 'upc',
  RELEASE_DATE: 'release_date',
  GENRE: 'genre',
  SUBGENRE: 'subgenre',
  COPYRIGHT_P: 'copyright_p',
  COPYRIGHT_C: 'copyright_c',
  TERRITORY: 'territory',
  LANGUAGE: 'language',
  EXPLICIT: 'explicit', // boolean-ish: true/false or 'clean'/'explicit' depending on your UI
  NOTES: 'notes',
})

export const ALBUM_META_LABELS = Object.freeze({
  [ALBUM_META_CODES.ALBUM_TITLE]: 'Album Title',
  [ALBUM_META_CODES.ARTIST_NAME]: 'Artist Name',
  [ALBUM_META_CODES.LABEL]: 'Label',
  [ALBUM_META_CODES.UPC]: 'UPC',
  [ALBUM_META_CODES.RELEASE_DATE]: 'Release Date',
  [ALBUM_META_CODES.GENRE]: 'Genre',
  [ALBUM_META_CODES.SUBGENRE]: 'Subgenre',
  [ALBUM_META_CODES.COPYRIGHT_P]: '℗ (Sound Recording)',
  [ALBUM_META_CODES.COPYRIGHT_C]: '© (Composition)',
  [ALBUM_META_CODES.TERRITORY]: 'Territory',
  [ALBUM_META_CODES.LANGUAGE]: 'Language',
  [ALBUM_META_CODES.EXPLICIT]: 'Explicit',
  [ALBUM_META_CODES.NOTES]: 'Notes',
})

// Optional: a single source of truth for rendering album meta fields.
// You can delete fields you don’t need, or add more later.
export const ALBUM_META_FIELDS = Object.freeze([
  { key: ALBUM_META_CODES.ALBUM_TITLE, label: ALBUM_META_LABELS[ALBUM_META_CODES.ALBUM_TITLE], type: 'text' },
  { key: ALBUM_META_CODES.ARTIST_NAME, label: ALBUM_META_LABELS[ALBUM_META_CODES.ARTIST_NAME], type: 'text' },
  { key: ALBUM_META_CODES.LABEL, label: ALBUM_META_LABELS[ALBUM_META_CODES.LABEL], type: 'text' },

  { key: ALBUM_META_CODES.UPC, label: ALBUM_META_LABELS[ALBUM_META_CODES.UPC], type: 'text' },
  { key: ALBUM_META_CODES.RELEASE_DATE, label: ALBUM_META_LABELS[ALBUM_META_CODES.RELEASE_DATE], type: 'date' },

  { key: ALBUM_META_CODES.GENRE, label: ALBUM_META_LABELS[ALBUM_META_CODES.GENRE], type: 'text' },
  { key: ALBUM_META_CODES.SUBGENRE, label: ALBUM_META_LABELS[ALBUM_META_CODES.SUBGENRE], type: 'text' },

  { key: ALBUM_META_CODES.COPYRIGHT_P, label: ALBUM_META_LABELS[ALBUM_META_CODES.COPYRIGHT_P], type: 'text' },
  { key: ALBUM_META_CODES.COPYRIGHT_C, label: ALBUM_META_LABELS[ALBUM_META_CODES.COPYRIGHT_C], type: 'text' },

  { key: ALBUM_META_CODES.TERRITORY, label: ALBUM_META_LABELS[ALBUM_META_CODES.TERRITORY], type: 'text' },
  { key: ALBUM_META_CODES.LANGUAGE, label: ALBUM_META_LABELS[ALBUM_META_CODES.LANGUAGE], type: 'text' },

  // If your UI uses a checkbox, keep as boolean. If it’s a select, you can map later.
  { key: ALBUM_META_CODES.EXPLICIT, label: ALBUM_META_LABELS[ALBUM_META_CODES.EXPLICIT], type: 'boolean' },

  { key: ALBUM_META_CODES.NOTES, label: ALBUM_META_LABELS[ALBUM_META_CODES.NOTES], type: 'textarea' },
])

// Optional: define which fields are required at minimum for "complete" status.
export const ALBUM_META_REQUIRED_KEYS = Object.freeze([
  ALBUM_META_CODES.ALBUM_TITLE,
  ALBUM_META_CODES.ARTIST_NAME,
])
// --- Album page constants (moved out of Album.jsx) ---
export const ALBUM_PAGE_DEFAULT_COVER_SIZE = "3000 × 3000 (JPG)";
export const ALBUM_PAGE_SONG_COUNT = 9;

// Slideshow limits
export const ALBUM_PAGE_SLIDESHOW_MAX = 3;

// IndexedDB
export const ALBUM_PAGE_ASSET_DB = "sb_assets";
export const ALBUM_PAGE_ASSET_STORE = "files";
