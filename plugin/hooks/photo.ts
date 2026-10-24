// Photo cards (api.md §11): what the mod checks before it sends one. The
// server checks it all again, strips metadata and runs the nudity filter.

/** api.md §11: the decoded image is at most 2 MiB; its base64 at most this many characters. */
export const MAX_PHOTO_BASE64 = 2_796_204

/** The two types the server takes, by the file's extension. */
export function photoMime(path: string): 'image/jpeg' | 'image/png' | undefined {
  const lower = path.trim().toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return undefined
}

/** An Image box that fits the pane's width, keeping the server's shape. */
export function photoBox(columns: number, rows: number, bodyColumns: number): { columns: number; rows: number } {
  const wide = Math.max(1, Math.min(255, columns, bodyColumns))
  const tall = Math.max(1, Math.min(255, Math.round((rows * wide) / Math.max(1, columns))))
  return { columns: wide, rows: tall }
}
