// Rows go to D1 as JSON text, a whole list per statement, which the SQL reads with json_each.
// D1 limits how many queries one request can make, so this keeps writing thousands of rows to a
// few statements. Each chunk stays well under D1's limit of 2 MB on a single value.

// Rows are passed to D1 as JSON, in parameters of at most this many characters
const MAX_CHUNK_LENGTH = 300_000

export function jsonChunks(rows: unknown[]): string[] {
  const chunks: string[] = []
  let chunk: string[] = []
  let length = 0
  for (const row of rows) {
    const json = JSON.stringify(row)
    if (chunk.length > 0 && length + json.length > MAX_CHUNK_LENGTH) {
      chunks.push(`[${chunk.join(',')}]`)
      chunk = []
      length = 0
    }
    chunk.push(json)
    length += json.length + 1
  }
  if (chunk.length > 0) chunks.push(`[${chunk.join(',')}]`)
  return chunks
}
