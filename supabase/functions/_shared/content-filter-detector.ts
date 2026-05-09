// Quick 260507-cf — surface upstream content guardrail rejections.
//
// Some providers (e.g. NewAPI → AWS Bedrock for claude-opus-4-7) return 200
// with a well-formed SSE stream where every frame's `delta.content` is empty
// and the only signal of failure is `finish_reason: 'content_filter'`. The
// PaperFlow client parser ignores delta-less frames and waits 30s for an
// inactivity timeout — to the user it looks like a silent stall.
//
// This transform pipes upstream bytes through unchanged AND injects a
// synthetic OpenAI-style chat.completion.chunk with a user-facing error
// message THE FIRST TIME it sees a content_filter frame on a stream that
// has emitted no content yet. The client parser yields the synthesized
// content so the user sees an actionable message immediately.
//
// Pass-through guarantee: every byte received from upstream is forwarded
// verbatim. The only added bytes are the synthetic `data: {...}\n\n` frame.

const ERROR_MESSAGE =
  '[upstream content guardrail blocked this request — the paper context or chat history likely tripped the model provider\'s safety filter. Try shortening the conversation or starting a new session.]'

export function makeContentFilterDetector(): TransformStream<Uint8Array, Uint8Array> {
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  let textBuf = ''
  let sawContent = false
  let injected = false

  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      textBuf += dec.decode(chunk, { stream: true })

      let frameEnd: number
      while ((frameEnd = textBuf.indexOf('\n\n')) !== -1) {
        const frame = textBuf.slice(0, frameEnd)
        textBuf = textBuf.slice(frameEnd + 2)
        const dataLine = frame.split(/\r?\n/).find((l) => l.startsWith('data: '))
        if (!dataLine) continue
        const payload = dataLine.slice(6).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload) as {
            id?: string
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>
          }
          const choice = json.choices?.[0]
          const content = choice?.delta?.content
          if (typeof content === 'string' && content.length > 0) sawContent = true
          if (
            choice?.finish_reason === 'content_filter' &&
            !sawContent &&
            !injected
          ) {
            const synth = JSON.stringify({
              id: json.id ?? 'pf-content-filter-synth',
              object: 'chat.completion.chunk',
              choices: [
                { index: 0, delta: { content: ERROR_MESSAGE, role: 'assistant' }, finish_reason: null },
              ],
            })
            controller.enqueue(enc.encode(`data: ${synth}\n\n`))
            injected = true
          }
        } catch {
          // malformed frame — skip silently
        }
      }
    },
  })
}
