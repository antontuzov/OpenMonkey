import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import storage from "../../src/utils/storage";
import { OpenMonkey } from "../../src/agent/OpenMonkey";
import type { ModelManager } from "../../src/models/model-manager";
import type { GenerateOptions } from "../../src/models/bonsai-gguf";

/**
 * A stand-in for the local model. It can answer normally, or write part of an answer
 * and then go away the way a crashed app does.
 */
class FakeModel {
  active = "mlx" as const;
  prompts: string[] = [];
  replies = 0;
  /** The text the next answer dies with, after writing this much of it. */
  crash: string | null = null;
  /** The conversation to look at while the answer is being written. */
  watch: string | null = null;
  /** What was on the disk while the answer was still being written. */
  duringStream: { content: string; unfinished: boolean | undefined } | null = null;

  async initialize(): Promise<void> {}

  restoreConversation(): void {}

  resetConversation(): void {}

  reset(): void {
    this.replies = 0;
    this.prompts = [];
    this.crash = null;
    this.duringStream = null;
  }

  async generateResponse(prompt: string, options?: GenerateOptions): Promise<string> {
    this.prompts.push(prompt);
    if (this.crash !== null) {
      const chunk = this.crash;
      this.crash = null;
      options?.onTextChunk?.(chunk);
      this.noteOnDisk();
      throw new Error("the model went away in the middle of the answer");
    }
    const answer = `answer ${++this.replies}`;
    options?.onTextChunk?.(answer);
    options?.onTokens?.(11);
    this.noteOnDisk();
    return answer;
  }

  private noteOnDisk(): void {
    if (!this.watch) return;
    const shown = storage.getMessages(this.watch, 50);
    const last = shown[shown.length - 1];
    if (!last || last.role !== "assistant") return;
    this.duringStream = { content: last.content, unfinished: last.metadata?.unfinished };
  }
}

const model = new FakeModel();
const agent = new OpenMonkey(model as unknown as ModelManager);

before(async () => {
  await agent.initialize();
});

after(() => {
  storage.close();
});

const start = (title: string) => {
  model.reset();
  const chat = storage.createConversation(title);
  model.watch = chat.id;
  return chat;
};

test("an answer that is being written is already on the disk, marked unfinished", async () => {
  const chat = start("Writing");
  await agent.processUserMessage(chat.id, "name the tree");

  assert.ok(model.duringStream);
  assert.equal(model.duringStream.unfinished, true);
  assert.equal(model.duringStream.content, "answer 1");

  const stored = storage.getMessages(chat.id, 50).at(-1);
  assert.equal(stored?.role, "assistant");
  assert.equal(stored?.metadata?.unfinished, undefined);
});

test("an answer that was cut off keeps its part and can be carried on", async () => {
  const chat = start("Crash");
  model.crash = "The tree is called an";
  await agent.processUserMessage(chat.id, "name the tree");

  const cut = storage.getMessages(chat.id, 50).at(-1);
  assert.equal(cut?.role, "assistant");
  assert.equal(cut?.content, "The tree is called an");
  assert.equal(cut?.metadata?.unfinished, true);

  const resumed = await agent.resumeAnswer(chat.id, cut!.id);
  assert.ok(resumed);
  assert.equal(resumed.id, cut!.id);
  assert.equal(resumed.content, "The tree is called ananswer 1");
  assert.equal(resumed.metadata?.unfinished, undefined);

  const stored = storage.getMessage(cut!.id);
  assert.equal(stored?.content, "The tree is called ananswer 1");
  assert.equal(stored?.metadata?.unfinished, undefined);

  // The answer grew on one row instead of becoming a second one.
  const shown = storage.getMessages(chat.id, 50);
  assert.deepEqual(
    shown.map((item) => item.content),
    ["name the tree", "The tree is called ananswer 1"]
  );
});

test("the model is asked to carry on, not to write the answer again", async () => {
  const chat = start("Prompt");
  model.crash = "The tree is called an";
  await agent.processUserMessage(chat.id, "name the tree");

  const cut = storage.getMessages(chat.id, 50).at(-1);
  await agent.resumeAnswer(chat.id, cut!.id);

  const prompt = model.prompts.at(-1) ?? "";
  assert.match(prompt, /continue/i);
  assert.match(prompt, /do not repeat/i);
});

test("an answer that has ended cannot be carried on", async () => {
  const chat = start("Ended");
  const answer = await agent.processUserMessage(chat.id, "name the tree");
  assert.ok(answer);

  await assert.rejects(() => agent.resumeAnswer(chat.id, answer.id), /already ended/i);
});

test("an answer that is not there cannot be carried on", async () => {
  const chat = start("Missing");
  await assert.rejects(() => agent.resumeAnswer(chat.id, "no_such_message"), /no longer exists/i);
  await assert.rejects(() => agent.resumeAnswer("no_such_conversation", "no_such_message"), /no longer exists/i);
});

test("a question of the user is not an answer to carry on", async () => {
  const chat = start("Question");
  await agent.processUserMessage(chat.id, "name the tree");
  const question = storage.getMessages(chat.id, 50).find((item) => item.role === "user");
  assert.ok(question);

  await assert.rejects(() => agent.resumeAnswer(chat.id, question.id), /no longer exists/i);
});
