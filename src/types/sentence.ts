// A finished English sentence with a code and the values it was made from, so code (such as a voice
// front-end) can tell what it says without reading it, and people (or the voice) get it word for
// word. Every reason, brief and refusal the prioritisation API returns is one of these, so nothing
// downstream has to word numbers itself.
export interface Sentence {
  code: string
  params: Record<string, string | number | boolean | string[] | null>
  text: string
}

// Several sentences as one paragraph
export const joinSentences = (parts: Sentence[]) => parts.map((p) => p.text).join(' ')
