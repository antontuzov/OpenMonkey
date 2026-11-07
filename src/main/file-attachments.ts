import * as fs from "node:fs";
import * as path from "node:path";
import { MAX_ATTACHMENT_BYTES } from "../utils/attachments";
import type { Attachment } from "../utils/types";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic"];

/**
 * Reads a file the user picked into an attachment the composer can carry.
 *
 * The limits are the ones the composer shows: a chat never carries more than
 * 256 KB, and a file that is not text is named rather than read.
 */
export function attachmentFromFile(filePath: string): Attachment {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`That file is ${Math.round(stat.size / 1024)} KB. Attachments are capped at 256 KB.`);
  }
  const name = path.basename(filePath);
  if (IMAGE_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase())) {
    return { name, bytes: stat.size, text: "", kind: "image" };
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.subarray(0, 8192).includes(0)) {
    throw new Error("Only plain text, code and image files can be attached.");
  }
  return { name, bytes: stat.size, text: buffer.toString("utf8"), kind: "text" };
}
