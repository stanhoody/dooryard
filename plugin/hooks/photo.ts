// Photo cards (api.md §11): the mod only draws them; posting is a web page.

/** An Image box that fits the pane's width, keeping the server's shape. */
export function photoBox(columns: number, rows: number, bodyColumns: number): { columns: number; rows: number } {
  const wide = Math.max(1, Math.min(255, columns, bodyColumns))
  const tall = Math.max(1, Math.min(255, Math.round((rows * wide) / Math.max(1, columns))))
  return { columns: wide, rows: tall }
}
