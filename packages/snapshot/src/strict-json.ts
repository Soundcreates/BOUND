/**
 * Strict JSON parser for trust-bearing bytes (snapshot, root record, attestation).
 *
 * Why not JSON.parse:
 *  - JSON.parse silently keeps the LAST duplicate key. Two readers using different
 *    parsers could then disagree about what a signed snapshot says. We reject duplicates.
 *  - JSON.parse turns `"__proto__"` into an own property but naive copying can turn it
 *    into a prototype write. We build null-prototype objects with defineProperty.
 *  - JSON.parse accepts floats, exponents, -0 and integers that are not exactly
 *    representable. Trust data only ever needs exactly-representable integers, so
 *    anything else is rejected here rather than silently rounded.
 *  - Depth and size are bounded so a depth bomb cannot exhaust the stack.
 *
 * Input must already be a JS string decoded with a FATAL UTF-8 decoder (see decodeUtf8Strict).
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface StrictParseLimits {
  maxDepth: number;
  maxLength: number;
  maxStringLength: number;
}

export const DEFAULT_LIMITS: StrictParseLimits = {
  maxDepth: 16,
  maxLength: 1_048_576,
  maxStringLength: 4096,
};

export class StrictJsonError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(`${message} at ${position}`);
    this.name = "StrictJsonError";
    this.position = position;
  }
}

/** Decode UTF-8 bytes, rejecting invalid sequences and a leading BOM. */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new StrictJsonError("byte-order mark not allowed", 0);
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

export function parseStrictJson(text: string, limits: StrictParseLimits = DEFAULT_LIMITS): JsonValue {
  if (text.length > limits.maxLength) throw new StrictJsonError("input too large", 0);
  let i = 0;

  const fail = (msg: string): never => {
    throw new StrictJsonError(msg, i);
  };

  const skipWs = () => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) i++;
      else break;
    }
  };

  const parseString = (): string => {
    // assumes text[i] === '"'
    i++;
    let out = "";
    let segStart = i;
    while (true) {
      if (i >= text.length) fail("unterminated string");
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(segStart, i);
        i++;
        break;
      }
      if (c < 0x20) fail("control character in string");
      if (c === 0x5c) {
        out += text.slice(segStart, i);
        i++;
        const e = text[i];
        switch (e) {
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "n": out += "\n"; break;
          case "r": out += "\r"; break;
          case "t": out += "\t"; break;
          case "u": {
            const hex = text.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("bad unicode escape");
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            fail("bad escape");
        }
        i++;
        segStart = i;
        continue;
      }
      i++;
    }
    if (out.length > limits.maxStringLength) fail("string too long");
    // Reject lone surrogates: they cannot be encoded as UTF-8 and would make
    // canonical bytes ambiguous.
    if (!out.isWellFormed()) fail("lone surrogate in string");
    return out;
  };

  const parseNumber = (): number => {
    const start = i;
    if (text[i] === "-") i++;
    if (text[i] === "0") {
      i++;
    } else if (text[i] !== undefined && text[i]! >= "1" && text[i]! <= "9") {
      while (text[i] !== undefined && text[i]! >= "0" && text[i]! <= "9") i++;
    } else {
      fail("bad number");
    }
    if (text[i] === "." || text[i] === "e" || text[i] === "E") {
      fail("only integers are allowed");
    }
    const raw = text.slice(start, i);
    if (raw === "-0") fail("negative zero not allowed");
    const n = Number(raw);
    if (!Number.isSafeInteger(n)) fail("integer not exactly representable");
    return n;
  };

  const parseValue = (depth: number): JsonValue => {
    if (depth > limits.maxDepth) fail("nesting too deep");
    skipWs();
    const c = text[i];
    if (c === "{") {
      i++;
      const obj = Object.create(null) as JsonObject;
      const seen = new Set<string>();
      skipWs();
      if (text[i] === "}") {
        i++;
        return obj;
      }
      while (true) {
        skipWs();
        if (text[i] !== '"') fail("expected object key");
        const key = parseString();
        if (seen.has(key)) fail(`duplicate key "${key}"`);
        seen.add(key);
        skipWs();
        if (text[i] !== ":") fail("expected ':'");
        i++;
        const v = parseValue(depth + 1);
        Object.defineProperty(obj, key, { value: v, enumerable: true, writable: false, configurable: false });
        skipWs();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return obj;
        }
        fail("expected ',' or '}'");
      }
    }
    if (c === "[") {
      i++;
      const arr: JsonValue[] = [];
      skipWs();
      if (text[i] === "]") {
        i++;
        return arr;
      }
      while (true) {
        arr.push(parseValue(depth + 1));
        skipWs();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return arr;
        }
        fail("expected ',' or ']'");
      }
    }
    if (c === '"') return parseString();
    if (c === "t" && text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (c === "f" && text.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (c === "n" && text.startsWith("null", i)) {
      i += 4;
      return null;
    }
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return parseNumber();
    return fail("unexpected token");
  };

  const value = parseValue(0);
  skipWs();
  if (i !== text.length) fail("trailing data");
  return value;
}

export function isJsonObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
