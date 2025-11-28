// ---------- Base64 ----------
function base64Encode(input) {
  return Buffer.from(input, "utf-8").toString("base64");
}
function base64Decode(encoded) {
  return Buffer.from(encoded, "base64").toString("utf-8");
}

// ---------- Hex ----------
function hexEncode(input) {
  return Buffer.from(input, "utf-8").toString("hex");
}
function hexDecode(encoded) {
  return Buffer.from(encoded, "hex").toString("utf-8");
}

// ---------- Binary ----------
function binaryEncode(input) {
  return Buffer.from(input, "utf-8").toString("binary");
}
function binaryDecode(encoded) {
  return Buffer.from(encoded, "binary").toString("utf-8");
}

// ---------- ASCII ----------
function asciiEncode(input) {
  return Buffer.from(input, "utf-8").toString("ascii");
}
function asciiDecode(encoded) {
  return Buffer.from(encoded, "ascii").toString("utf-8");
}

// ---------- UTF-8 ----------
function utf8Encode(input) {
  return Buffer.from(input, "utf-8").toString();
}
function utf8Decode(encoded) {
  return Buffer.from(encoded, "utf-8").toString();
}

// ---------- UTF-16LE ----------
function utf16Encode(input) {
  return Buffer.from(input, "utf16le").toString("base64"); // store as base64-safe form
}
function utf16Decode(encoded) {
  return Buffer.from(encoded, "base64").toString("utf16le");
}

// ---------- Latin1 ----------
function latin1Encode(input) {
  return Buffer.from(input, "latin1").toString("base64");
}
function latin1Decode(encoded) {
  return Buffer.from(encoded, "base64").toString("latin1");
}

// ---------- URL / URI ----------
function urlEncode(input) {
  return encodeURIComponent(input);
}
function urlDecode(encoded) {
  return decodeURIComponent(encoded);
}

const packageExports = {
  base64Encode,
  base64Decode,
  hexEncode,
  hexDecode,
  binaryEncode,
  binaryDecode,
  asciiEncode,
  asciiDecode,
  utf8Encode,
  utf8Decode,
  utf16Encode,
  utf16Decode,
  latin1Encode,
  latin1Decode,
  urlEncode,
  urlDecode
}

export {
  base64Encode,
  base64Decode,
  hexEncode,
  hexDecode,
  binaryEncode,
  binaryDecode,
  asciiEncode,
  asciiDecode,
  utf8Encode,
  utf8Decode,
  utf16Encode,
  utf16Decode,
  latin1Encode,
  latin1Decode,
  urlEncode,
  urlDecode,
  packageExports
};
