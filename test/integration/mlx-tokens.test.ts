import { test } from "node:test";
import assert from "node:assert/strict";
import { MLXServer } from "../../src/models/mlx-server";

/** A stream of SSE frames, the way an OpenAI-compatible server talks. */
const stream = (frames: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      }
    }),
    { headers: { "content-type": "text/event-stream" } }
  );

const server = () => new MLXServer({ modelPath: "/tmp/none.gguf", port: 8, host: "127.0.0.1" });

const withFetch = async <T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> => {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

test("a streamed answer reports the tokens the server counted", async () => {
  let sent: { stream_options?: { include_usage?: boolean }; stream?: boolean } | null = null;

  await withFetch(
    (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return stream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":7}}\n\n',
        "data: [DONE]\n\n",
      ]);
    }) as unknown as typeof fetch,
    async () => {
      let tokens = 0;
      const chunks: string[] = [];
      const text = await server().generate("hi", {
        onTextChunk: (chunk) => chunks.push(chunk),
        onTokens: (count) => {
          tokens = count;
        },
      });

      assert.equal(text, "Hello there");
      assert.deepEqual(chunks, ["Hello", " there"]);
      assert.equal(tokens, 7);
      // The count only arrives when the stream is asked for usage.
      assert.deepEqual(sent?.stream_options, { include_usage: true });
      assert.equal(sent?.stream, true);
    }
  );
});

test("a plain answer reports its tokens too", async () => {
  await withFetch(
    (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Hello there" } }],
          usage: { completion_tokens: 5 },
        }),
        { headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch,
    async () => {
      let tokens = 0;
      const text = await server().generate("hi", {
        onTokens: (count) => {
          tokens = count;
        },
      });
      assert.equal(text, "Hello there");
      assert.equal(tokens, 5);
    }
  );
});

test("a server that counts nothing reports no tokens at all", async () => {
  await withFetch(
    (async () =>
      stream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      ])) as unknown as typeof fetch,
    async () => {
      let called = false;
      const text = await server().generate("hi", {
        onTokens: () => {
          called = true;
        },
      });
      assert.equal(text, "Hello");
      // No made-up number: a reply without a count simply has no count.
      assert.equal(called, false);
    }
  );
});
