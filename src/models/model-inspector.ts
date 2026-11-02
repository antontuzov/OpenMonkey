import * as fs from "node:fs";
import logger from "../utils/logger";
import type { ModelMemoryEstimate } from "../utils/types";

type LlamaCppModule = typeof import("node-llama-cpp");

/**
 * node-llama-cpp is ESM with top-level await, so `require()` throws and a literal
 * `await import()` is rewritten to `require()` when this file bundles to CJS.
 * Constructing the import through Function keeps it a genuine runtime import.
 */
function importLlamaCpp(): Promise<LlamaCppModule> {
  return new Function("return import('node-llama-cpp')")() as Promise<LlamaCppModule>;
}

/**
 * Reads the GGUF header to size the weights and the KV cache. Nothing is
 * loaded into RAM: the point is to tell the user what the model will cost
 * before they ask for it.
 *
 * The estimate assumes the weights stay in RAM and the GPU is not used, which
 * is the worst case on this hardware.
 */
export async function estimateModelMemory(
  modelPath: string,
  contextSize: number
): Promise<ModelMemoryEstimate | null> {
  if (!fs.existsSync(modelPath)) return null;

  try {
    const { readGgufFileInfo, GgufInsights } = await importLlamaCpp();
    const info = await readGgufFileInfo(modelPath);
    const insights = await GgufInsights.from(info);

    const weights = await insights.estimateModelResourceRequirementsV2({
      gpuLayers: 0,
      useMmap: true,
    });
    const context = await insights.estimateContextResourceRequirementsV2({
      contextSize,
      modelGpuLayers: 0,
      useMmap: true,
    });

    const trainContextSize = insights.trainContextSize ?? null;
    return {
      modelBytes: weights.cpuRam + weights.gpuVram,
      contextBytes: context.cpuRam + context.gpuVram,
      cpuRamBytes: weights.cpuRam + context.cpuRam,
      gpuVramBytes: weights.gpuVram + context.gpuVram,
      contextSize,
      trainContextSize,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("model.memory.estimate.failed", { error: message });
    return null;
  }
}
