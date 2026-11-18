/**
 * UTF-8 encode/decode following the WHATWG Encoding Standard, i.e. identical to TextEncoder and
 * TextDecoder (lone surrogates and malformed bytes become U+FFFD). Kept dependency-free because
 * TextDecoder availability differs between JS engines; tests compare against Node's built-ins.
 */

const REPLACEMENT = 0xfffd;

export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    let cp = char.codePointAt(0) ?? REPLACEMENT;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = REPLACEMENT; // lone surrogate
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  const out: number[] = [];
  let needed = 0;
  let seen = 0;
  let cp = 0;
  let lower = 0x80;
  let upper = 0xbf;

  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] as number;
    if (needed === 0) {
      if (byte <= 0x7f) {
        out.push(byte);
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1;
        cp = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte === 0xe0) lower = 0xa0;
        if (byte === 0xed) upper = 0x9f;
        needed = 2;
        cp = byte & 0x0f;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte === 0xf0) lower = 0x90;
        if (byte === 0xf4) upper = 0x8f;
        needed = 3;
        cp = byte & 0x07;
      } else {
        out.push(REPLACEMENT);
      }
      continue;
    }
    if (byte < lower || byte > upper) {
      // malformed: emit one replacement and reprocess this byte as a fresh start
      needed = 0;
      seen = 0;
      cp = 0;
      lower = 0x80;
      upper = 0xbf;
      out.push(REPLACEMENT);
      i -= 1;
      continue;
    }
    lower = 0x80;
    upper = 0xbf;
    cp = (cp << 6) | (byte & 0x3f);
    seen += 1;
    if (seen === needed) {
      out.push(cp);
      needed = 0;
      seen = 0;
      cp = 0;
    }
  }
  if (needed !== 0) out.push(REPLACEMENT);

  let text = '';
  for (let i = 0; i < out.length; i += 4096) text += String.fromCodePoint(...out.slice(i, i + 4096));
  return text;
}
