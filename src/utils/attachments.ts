import type { Attachment } from "./types";

/** How many files one message may carry; the composer shows the same number. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 8;
/** A single file may be this large; the composer refuses anything bigger. */
export const MAX_ATTACHMENT_BYTES = 256 * 1024;
/** The text of an attachment is truncated at this length before it reaches the model. */
export const MAX_ATTACHMENT_TEXT = 400_000;

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * The prompt the model actually sees. Text files are quoted in full; an image is
 * named but not decoded, because the local models here read text only — saying so
 * is better than pretending the pixels are there.
 */
export function buildAttachmentPrompt(message: string, files: Attachment[]): string {
  if (!files.length) return message;
  const blocks = files.map((file) => {
    if (file.kind === "image") {
      return `The user attached an image named "${file.name}" (${formatBytes(file.bytes)}). The local models here read text only, so the image is named but not shown.`;
    }
    const body = file.text.length > MAX_ATTACHMENT_TEXT
      ? `${file.text.slice(0, MAX_ATTACHMENT_TEXT)}\n… (truncated)`
      : file.text;
    return `The user attached a text file named "${file.name}" (${formatBytes(file.bytes)}). Use it as context.\n\n--- ${file.name} ---\n${body}\n--- end ${file.name} ---`;
  });
  return `${blocks.join("\n\n")}\n\n${message}`.trim();
}
