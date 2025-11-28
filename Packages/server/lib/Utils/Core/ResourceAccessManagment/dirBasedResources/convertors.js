import fs from "fs";
import { fileTypeFromBuffer } from "file-type";
import mime from "mime-types";
import { logger } from '../../../logger.js';

const fileToBase64 = (filePath) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    return fileBuffer.toString("base64");
  } catch {
    return null;
  }
};

const base64ToFile = (base64String, outputPath) => {
  try {
    const fileBuffer = Buffer.from(base64String, "base64");
    fs.writeFileSync(outputPath, fileBuffer);
    return true;
  } catch {
    return false;
  }
};

const getFileType = async (base64File, filePath) => {
  try {
    const buffer = Buffer.from(base64File, "base64");
    const detectedType = await fileTypeFromBuffer(buffer);

    if (detectedType && detectedType.mime) {
      return detectedType.mime;
    }

    const ext = filePath?.split(".").pop()?.toLowerCase();
    const inferredMime = mime.lookup(ext);

    if (inferredMime) {
      return inferredMime;
    }

    const manualMap = {
      md: "text/markdown",
      txt: "text/plain",
      csv: "text/csv",
      log: "text/plain",
      json: "application/json",
      xml: "application/xml",
      yml: "text/yaml",
      yaml: "text/yaml",
      pdf: "application/pdf",
      zip: "application/zip",
      gz: "application/gzip",
      tar: "application/x-tar",
      rar: "application/vnd.rar",
      exe: "application/vnd.microsoft.portable-executable",
      dll: "application/vnd.microsoft.portable-executable",
      wasm: "application/wasm",
      svg: "image/svg+xml",
      webp: "image/webp",
      ico: "image/x-icon",
      tif: "image/tiff",
      tiff: "image/tiff",
      heic: "image/heic",
      heif: "image/heif",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      flac: "audio/flac",
      mp4: "video/mp4",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      mkv: "video/x-matroska",
      webm: "video/webm",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      otf: "font/otf",
      ttf: "font/ttf",
      woff: "font/woff",
      woff2: "font/woff2",
      html: "text/html",
      htm: "text/html",
      js: "application/javascript",
      mjs: "application/javascript",
      cjs: "application/javascript",
      ts: "application/typescript",
      jsx: "text/jsx",
      tsx: "text/tsx",
      css: "text/css",
      scss: "text/x-scss",
      less: "text/x-less",
    };

    if (manualMap[ext]) {
      return manualMap[ext];
    }

    return "application/octet-stream";
  } catch (err) {
    logger.error("Error detecting file type:", err);
    return "application/octet-stream";
  }
};

export { getFileType, base64ToFile, fileToBase64 };
