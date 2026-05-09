// chrome-extension/tests/eval/sse.ts
//
// Phase 14 EVAL-03 — SSE Data Stream Protocol parser, factored out of
// chrome-extension/reader/lib/agent-client.ts:290-345 + the test fixture
// chrome-extension/tests/agent-runtime-fixtures.ts:84-136.
//
// PURE Node consumer — no extension-runtime APIs, no supabase imports. Reads
// a ReadableStream<Uint8Array> and yields parsed JSON frames.
//
// Behavior:
//   - LF-LF and CRLF-CRLF frame separators both supported (mirror server)
//   - Comment frames (lines starting with `:`) are SKIPPED (NOT yielded)
//   - `data: [DONE]` terminates the stream cleanly
//   - Non-JSON `data:` payloads are ignored (defensive — never throws)

export type SSEFrame = {
  type: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  delta?: string
  finishReason?: string
  totalTokens?: number
  [k: string]: unknown
}

export async function* parseSSEFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEFrame, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const lf = buffer.indexOf('\n\n')
      const crlf = buffer.indexOf('\r\n\r\n')
      let pos: number
      let len: number
      if (lf === -1 && crlf === -1) break
      if (lf === -1) {
        pos = crlf
        len = 4
      } else if (crlf === -1) {
        pos = lf
        len = 2
      } else if (crlf < lf) {
        pos = crlf
        len = 4
      } else {
        pos = lf
        len = 2
      }

      const frameStr = buffer.slice(0, pos)
      buffer = buffer.slice(pos + len)

      // Comment / keepalive frames — SKIP (do not yield).
      if (frameStr.startsWith(':')) continue

      const dataLine = frameStr.split(/\r?\n/).find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      const payload = dataLine.slice(6).trim()
      if (payload === '[DONE]') return

      try {
        yield JSON.parse(payload) as SSEFrame
      } catch {
        // ignore non-JSON frames (defensive)
      }
    }
  }
}
