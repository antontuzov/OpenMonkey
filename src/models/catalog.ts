/**
 * Pure data shared by the in-app downloader and scripts/download-models.ts.
 * The revision and digest are pinned so a download is reproducible and verifiable.
 */
export interface GgufModelEntry {
  id: string;
  name: string;
  repo: string;
  revision: string;
  file: string;
  dirName: string;
  bytes: number;
  sha256: string;
  /** Overrides the Hugging Face path: a mirror, or the local server the tests run. */
  url?: string;
}

export const BONSAI_4B: GgufModelEntry = {
  id: "bonsai-4b",
  name: "Bonsai-4B",
  repo: "prism-ml/Bonsai-4B-gguf",
  revision: "78f2c2bacd0904ffaba24b4873ed975e5818354a",
  file: "Bonsai-4B.gguf",
  dirName: "Bonsai-4B-gguf",
  bytes: 572_270_624,
  sha256: "4524b3f997f0f06444e568d1f26e2efd69effa3218c7ad3047432fb171e42168",
};

export const GGUF_MODELS = [BONSAI_4B];

export function hfResolveUrl(entry: GgufModelEntry): string {
  return entry.url ?? `https://huggingface.co/${entry.repo}/resolve/${entry.revision}/${entry.file}`;
}
