/**
 * Encoder/decoder for Mythic Dungeon Tools route strings.
 *
 * Current format (Modules/Transmission.lua):
 *   "!~MDT2~" + Base64( Deflate( CBOR( preset ) ) )
 *
 * Two things about the payload are deliberately not assumed:
 *
 *  - Which deflate flavour Blizzard's `CompressionMethod.Deflate` means.
 *  - Whether a Lua sequence is emitted as a CBOR array or as a map keyed 1..n.
 *  - Whether Lua strings arrive as CBOR byte strings or text strings.
 *
 * Decoding tolerates every variant and reports what it found; encoding
 * mirrors whatever a decoded route used, so re-exporting is faithful.
 *
 * Verified against a real in-game export (MDT addonVersion 629): raw deflate,
 * sequences as CBOR arrays, and strings as BYTE strings — Lua strings are
 * byte arrays rather than guaranteed UTF-8, so Blizzard encodes them as
 * major type 2. Emitting text strings instead is what a hand-built route
 * would get wrong, and the addon rejects it.
 */
import { Encoder } from 'cbor-x'
import { deflateRaw, inflateRaw, deflate, inflate, gzip, ungzip } from 'pako'

export const MDT2_PREFIX = '!~MDT2~'

export type Compression = 'raw' | 'zlib' | 'gzip'
/** How Lua sequences came across the wire. */
export type ListStyle = 'array' | 'map'
/** How Lua strings came across the wire. */
export type StringStyle = 'bytes' | 'text'

export interface Dialect {
  compression: Compression
  lists: ListStyle
  strings: StringStyle
}

/** What a real MDT export looks like; see the note at the top of this file. */
export const MDT_DIALECT: Dialect = { compression: 'raw', lists: 'array', strings: 'bytes' }

export interface DecodeResult {
  preset: unknown
  dialect: Dialect
}

/*
 * Maps must NOT be flattened to objects: MDT's pull tables mix integer enemy
 * keys with a string "color" key, and stringifying the integers makes the
 * addon drop every pull. The same configured instance has to decode too —
 * cbor-x's bare `decode()` defaults to mapsAsObjects:true.
 */
const codec = new Encoder({
  mapsAsObjects: false,
  useRecords: false,
  variableMapSize: true,
  // cbor-x tags every Uint8Array with CBOR tag 64 ("uint8 typed array") by
  // default. The game emits bare byte strings, so the tag is 2 extra bytes of
  // meaning Blizzard's deserializer never asked for — leave it on and the
  // addon sees a tagged value where it expects a plain Lua string.
  tagUint8Array: false,
})

/* ---------- byte strings <-> text ---------- */

const decoder = new TextDecoder()
const encoderUtf8 = new TextEncoder()

/**
 * Turns CBOR byte strings into JS strings, in both keys and values.
 * Without this every key arrives as a Uint8Array and nothing resolves.
 */
function fromWire(v: unknown): unknown {
  if (v instanceof Uint8Array) return decoder.decode(v)
  if (Array.isArray(v)) return v.map(fromWire)
  if (v instanceof Map) {
    const out = new Map<unknown, unknown>()
    for (const [k, val] of v) out.set(fromWire(k), fromWire(val))
    return out
  }
  return v
}

/** Re-encodes JS strings the way the addon expects to read them back. */
function toWire(v: unknown, strings: StringStyle): unknown {
  if (typeof v === 'string') return strings === 'bytes' ? encoderUtf8.encode(v) : v
  if (Array.isArray(v)) return v.map((x) => toWire(x, strings))
  if (v instanceof Map) {
    const out = new Map<unknown, unknown>()
    for (const [k, val] of v) out.set(toWire(k, strings), toWire(val, strings))
    return out
  }
  return v
}

/* ---------- reading a decoded tree ---------- */

/** Reads a string-keyed field from a CBOR map or plain object. */
export function field(node: unknown, name: string): unknown {
  if (node instanceof Map) return node.get(name)
  if (node && typeof node === 'object') return (node as Record<string, unknown>)[name]
  return undefined
}

/** Values of a Lua sequence, whether it arrived as an array or a 1..n map. */
export function luaList(node: unknown): unknown[] {
  if (node == null) return []
  if (Array.isArray(node)) return node
  if (node instanceof Map) {
    return [...node.keys()]
      .filter((k): k is number => typeof k === 'number')
      .sort((a, b) => a - b)
      .map((k) => node.get(k))
  }
  return []
}

/** Entries of a Lua table with key types preserved. */
export function luaPairs(node: unknown): [number | string, unknown][] {
  if (node instanceof Map) return [...node.entries()] as [number | string, unknown][]
  if (Array.isArray(node)) return node.map((v, i) => [i + 1, v])
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).map(([k, v]) =>
      /^\d+$/.test(k) ? [Number(k), v] : [k, v]
    )
  }
  return []
}

/** Detects whether sequences in a decoded route are arrays or 1..n maps. */
function detectListStyle(preset: unknown): ListStyle {
  const pulls = field(field(preset, 'value'), 'pulls')
  if (Array.isArray(pulls)) return 'array'
  if (pulls instanceof Map) return 'map'
  return 'array'
}

/** True when any key in the raw tree arrived as a byte string. */
function usesByteStrings(node: unknown, depth = 0): boolean {
  if (depth > 4) return false
  if (node instanceof Map) {
    for (const [k, v] of node) {
      if (k instanceof Uint8Array) return true
      if (usesByteStrings(v, depth + 1)) return true
    }
  } else if (Array.isArray(node)) {
    for (const v of node.slice(0, 8)) if (usesByteStrings(v, depth + 1)) return true
  } else if (node instanceof Uint8Array) {
    return true
  }
  return false
}

/* ---------- writing ---------- */

/** Builds a Lua sequence in the requested representation. */
export function toLuaList(values: unknown[], style: ListStyle): unknown {
  if (style === 'array') return values
  return new Map(values.map((v, i) => [i + 1, v]))
}

/* ---------- transport ---------- */

const toBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

const toBase64 = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b

/** zlib: low nibble 8 (deflate) and a header that checksums to a multiple of 31. */
const isZlib = (b: Uint8Array) =>
  b.length > 2 && (b[0] & 0x0f) === 0x08 && ((b[0] << 8) | b[1]) % 31 === 0

function decompress(bytes: Uint8Array): { data: Uint8Array; compression: Compression } {
  // Order matters, and headers are checked rather than inferred from success:
  // pako's `inflate` transparently accepts gzip too, so trying it first would
  // label every gzip stream as zlib.
  const attempts: [Compression, (b: Uint8Array) => Uint8Array][] = isGzip(bytes)
    ? [['gzip', ungzip], ['raw', inflateRaw]]
    : isZlib(bytes)
      ? [['zlib', inflate], ['raw', inflateRaw]]
      : [['raw', inflateRaw], ['zlib', inflate], ['gzip', ungzip]]

  for (const [compression, fn] of attempts) {
    try {
      const data = fn(bytes)
      if (data?.length) return { data, compression }
    } catch {
      // fall through to the next flavour
    }
  }
  throw new Error('Could not decompress — not a recognised deflate stream.')
}

function compress(bytes: Uint8Array, how: Compression): Uint8Array {
  if (how === 'zlib') return deflate(bytes)
  if (how === 'gzip') return gzip(bytes)
  return deflateRaw(bytes)
}

export function isLegacyString(input: string): boolean {
  const s = input.trim()
  return s.startsWith('!') && !s.startsWith(MDT2_PREFIX)
}

export function decodeMdtString(input: string): DecodeResult {
  const s = input.trim().replace(/\s+/g, '')
  if (!s) throw new Error('Paste an MDT route string first.')

  if (isLegacyString(s)) {
    throw new Error(
      'That looks like a legacy MDT string (LibDeflate + AceSerializer). ' +
        'Re-export it from a current MDT to get an "!~MDT2~" string.'
    )
  }
  if (!s.startsWith(MDT2_PREFIX)) {
    throw new Error('Not an MDT route string — expected it to start with "!~MDT2~".')
  }

  const { data, compression } = decompress(toBytes(s.slice(MDT2_PREFIX.length)))
  const raw = codec.decode(data) as unknown
  const strings: StringStyle = usesByteStrings(raw) ? 'bytes' : 'text'
  const preset = fromWire(raw)

  if (typeof field(field(preset, 'value'), 'currentDungeonIdx') !== 'number') {
    throw new Error('Decoded, but this does not look like a route (no dungeon index).')
  }
  return { preset, dialect: { compression, lists: detectListStyle(preset), strings } }
}

export function encodeMdtString(preset: unknown, dialect: Dialect = MDT_DIALECT): string {
  const wire = toWire(preset, dialect.strings)
  return MDT2_PREFIX + toBase64(compress(codec.encode(wire), dialect.compression))
}
