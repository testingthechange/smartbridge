// minisite/album/meta/albumMeta.defaults.js
// Default album meta state (safe initial values).

import { ALBUM_META_CODES } from './albumMeta.codes'

export const DEFAULT_ALBUM_META = Object.freeze({
  [ALBUM_META_CODES.ALBUM_TITLE]: '',
  [ALBUM_META_CODES.ARTIST_NAME]: '',
  [ALBUM_META_CODES.LABEL]: '',

  [ALBUM_META_CODES.UPC]: '',
  [ALBUM_META_CODES.RELEASE_DATE]: '',

  [ALBUM_META_CODES.GENRE]: '',
  [ALBUM_META_CODES.SUBGENRE]: '',

  [ALBUM_META_CODES.COPYRIGHT_P]: '',
  [ALBUM_META_CODES.COPYRIGHT_C]: '',

  [ALBUM_META_CODES.TERRITORY]: '',
  [ALBUM_META_CODES.LANGUAGE]: '',

  // keep boolean (recommended). If your UI stores 'explicit'/'clean', adapt in utils.
  [ALBUM_META_CODES.EXPLICIT]: false,

  [ALBUM_META_CODES.NOTES]: '',
})
