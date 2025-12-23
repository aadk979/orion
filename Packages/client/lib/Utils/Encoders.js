// ---------- Base64 ----------
export function base64Encode(input) {
  return btoa(
    new TextEncoder()
      .encode(input)
      .reduce((data, byte) => data + String.fromCharCode(byte), "")
  );
}

export function base64Decode(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// ---------- uint8 to Base64 ----------
export function base64EncodeUint8(uint8) {
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

export function base64DecodeToUint8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------- Hex ----------
export function hexEncode(input) {
  return Array.from(new TextEncoder().encode(input))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexDecode(encoded) {
  const bytes = new Uint8Array(
    encoded.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
  );
  return new TextDecoder().decode(bytes);
}

// ---------- Binary ----------
export function binaryEncode(input) {
  return Array.from(new TextEncoder().encode(input))
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");
}

export function binaryDecode(encoded) {
  const bytes = new Uint8Array(
    encoded.match(/.{1,8}/g).map((bin) => parseInt(bin, 2))
  );
  return new TextDecoder().decode(bytes);
}

// ---------- ASCII ----------
export function asciiEncode(input) {
  return Array.from(input)
    .map((c) => c.charCodeAt(0).toString(16))
    .join("");
}

export function asciiDecode(encoded) {
  return encoded
    .match(/.{1,2}/g)
    .map((h) => String.fromCharCode(parseInt(h, 16)))
    .join("");
}

// ---------- UTF-8 ----------
export function utf8Encode(input) {
  return new TextEncoder().encode(input);
}

export function utf8Decode(bytes) {
  return new TextDecoder().decode(bytes);
}

// ---------- UTF-16LE ----------
export function utf16Encode(input) {
  const buf = new Uint8Array(new TextEncoder("utf-16le").encode(input));
  return base64EncodeUint8(buf);
}

export function utf16Decode(encoded) {
  const bytes = base64DecodeToUint8(encoded);
  return new TextDecoder("utf-16le").decode(bytes);
}

// ---------- Latin1 ----------
export function latin1Encode(input) {
  const bytes = Uint8Array.from(
    input.split("").map((c) => c.charCodeAt(0) & 0xff)
  );
  return base64EncodeUint8(bytes);
}

export function latin1Decode(encoded) {
  const bytes = base64DecodeToUint8(encoded);
  return Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
}

// ---------- URL / URI ----------
export function urlEncode(input) {
  return encodeURIComponent(input);
}

export function urlDecode(encoded) {
  return decodeURIComponent(encoded);
}
