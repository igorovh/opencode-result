export type ImageKind = { mime: string; ext: string; width: number; height: number }

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8)
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0
const ascii = (b: Uint8Array, i: number, length: number) => String.fromCharCode(...b.subarray(i, i + length))

/** Detects PNG, JPEG, GIF and WebP from their bytes and reads the pixel size. */
export function sniffImage(bytes: Uint8Array): ImageKind | undefined {
  if (bytes.length < 16) return
  if (u32be(bytes, 0) === 0x89504e47 && u32be(bytes, 4) === 0x0d0a1a0a)
    return { mime: "image/png", ext: "png", width: u32be(bytes, 16), height: u32be(bytes, 20) }
  if (ascii(bytes, 0, 4) === "GIF8")
    return { mime: "image/gif", ext: "gif", width: u16le(bytes, 6), height: u16le(bytes, 8) }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg", ...jpegSize(bytes) }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP" && bytes.length >= 30) {
    const chunk = ascii(bytes, 12, 4)
    const size =
      chunk === "VP8 "
        ? { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff }
        : chunk === "VP8L"
          ? {
              width: 1 + (((bytes[22]! & 0x3f) << 8) | bytes[21]!),
              height: 1 + (((bytes[24]! & 0x0f) << 10) | (bytes[23]! << 2) | ((bytes[22]! & 0xc0) >> 6)),
            }
          : { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) }
    return { mime: "image/webp", ext: "webp", ...size }
  }
}

function jpegSize(bytes: Uint8Array) {
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++
      continue
    }
    const marker = bytes[i + 1]!
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) return { width: u16be(bytes, i + 7), height: u16be(bytes, i + 5) }
    i += 2 + u16be(bytes, i + 2)
  }
  return { width: 0, height: 0 }
}
