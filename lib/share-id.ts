/**
 * Short ids for share links.
 *
 * Ambiguous glyphs (0/O, 1/l/I) are left out so an id survives being read
 * aloud in voice chat or typed from a screenshot.
 */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
const ID_LENGTH = 7
/** Long enough that guessing another route's link isn't practical. */
const TOKEN_LENGTH = 32

function randomFrom(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  // Rejection-free mapping is unnecessary here; the slight modulo bias over a
  // 31-character alphabet doesn't matter for link ids.
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

export const newShareId = () => randomFrom(ALPHABET, ID_LENGTH)
export const newEditToken = () => randomFrom('abcdefghijklmnopqrstuvwxyz0123456789', TOKEN_LENGTH)

export const isShareId = (s: string) =>
  s.length === ID_LENGTH && [...s].every((c) => ALPHABET.includes(c))
