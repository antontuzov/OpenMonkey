// Measures the local model on this Mac through the same code path the app uses:
// Settings → Performance runs exactly this pair of numbers.
//
//   npm run benchmark-model [path/to/model.gguf]
import * as fs from "node:fs";
import * as path from "node:path";
import { BONSAI_4B } from "../src/models/catalog";
import { BonsaiGGUF } from "../src/models/bonsai-gguf";
import { estimateModelMemory } from "../src/models/model-inspector";
import {
  BENCHMARK_MAX_TOKENS,
  BENCHMARK_PROMPT,
  formatBytes,
  formatMilliseconds,
  toBenchmark,
} from "../src/models/benchmark";

const CONTEXT_SIZE = 4096;
const ROOT = path.resolve(__dirname, "..");

async function main(): Promise<void> {
  const modelPath = path.resolve(
    process.argv[2] ?? path.join(ROOT, "models", BONSAI_4B.dirName, BONSAI_4B.file)
  );
  if (!fs.existsSync(modelPath)) {
    console.error(`No model at ${modelPath}. Run: npm run download-models`);
    process.exitCode = 1;
    return;
  }

  const memory = await estimateModelMemory(modelPath, CONTEXT_SIZE);
  if (memory) {
    console.log(`weights      ${formatBytes(memory.modelBytes)}`);
    console.log(`kv cache     ${formatBytes(memory.contextBytes)} @ ${memory.contextSize} tokens`);
    console.log(`train ctx    ${memory.trainContextSize ?? "unknown"}`);
    console.log(
      `ram needed   ${formatBytes(memory.cpuRamBytes)} system + ${formatBytes(memory.gpuVramBytes)} gpu`
    );
  } else {
    console.error("Memory estimate failed; the GGUF header could not be read.");
  }

  const model = new BonsaiGGUF({ modelPath, contextSize: CONTEXT_SIZE });
  console.log("\nLoading the weights…");
  await model.load();
  const result = toBenchmark(await model.benchmark(BENCHMARK_PROMPT, BENCHMARK_MAX_TOKENS));
  await model.unload();

  console.log(`\n${result.tokensPerSecond.toFixed(1)} tokens/second on ${result.provider}`);
  console.log(`  first token  ${formatMilliseconds(result.timeToFirstTokenMs)}`);
  console.log(`  generated    ${result.tokens} tokens in ${formatMilliseconds(result.generationMs)}`);
  console.log(`  model size   ${formatBytes(result.modelBytes)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
