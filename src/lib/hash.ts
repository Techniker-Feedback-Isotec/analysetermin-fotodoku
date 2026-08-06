/** SHA-256 ueber die rohen Datei-Bytes (WebCrypto), als Hex-String. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
