/** Strips CSI and OSC (incl. OSC 8 hyperlink) escape sequences from terminal output. */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
}

/** First `https://…/oauth/authorize?…` URL in accumulated login output; only once it is followed by whitespace (so a URL cut by a chunk boundary is not returned half). */
export function extractLoginUrl(raw: string): string | null {
  const m = stripAnsi(raw).match(/https:\/\/[^\s\x07\x1b]+\/oauth\/authorize\?[^\s\x07\x1b]*(?=\s)/)
  return m ? m[0] : null
}
