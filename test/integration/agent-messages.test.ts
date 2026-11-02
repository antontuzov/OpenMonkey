import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import storage from "../../src/utils/storage";
import { OpenMonkey } from "../../src/agent/OpenMonkey";
import type { ModelManager } from "../../src/models/model-manager";
import type { GenerateOptions } from "../../src/models/bonsai-gguf";

/**
 * A stand-in for the local model. It answers with a numbered line and reports the
 * token count the real backends send, so the agent's own bookkeeping is what
 * gets tested rather than the model.
 */
class FakeModel {
  active = "mlx" as const;
  prompts: string[] = [];
  replies = 0;

  async initialize(): Promise<void> {}

  restoreConversation(): void {}

  resetConversation(): void {}

  reset(): void {
    this.replies = 0;
    this.prompts = [];
  }

  async generateResponse(prompt: string, options?: GenerateOptions): Promise<string> {
    this.prompts.push(prompt);
    const answer = `answer ${++this.replies}`;
    options?.onTextChunk?.(answer);
    options?.onTokens?.(11);
    return answer;
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
  return storage.createConversation(title);
};

test("an answer carries the duration and the tokens the model reported", async () => {
  const chat = start("Tokens");
  const answer = await agent.processUserMessage(chat.id, "how many tokens?");

  assert.ok(answer);
  assert.equal(answer.metadata?.tokens, 11);
  assert.equal(typeof answer.metadata?.durationMs, "number");
  const stored = storage.getMessage(answer.id);
  assert.equal(stored?.metadata?.tokens, 11);
});

test("a regenerated answer keeps the one it replaces, and the chat shows the newest", async () => {
  const chat = start("Regenerate");
  const first = await agent.processUserMessage(chat.id, "name the tree");
  assert.ok(first);
  const second = await agent.regenerate(chat.id);
  assert.ok(second);

  assert.equal(second.metadata?.variantOf, first.id);
  assert.equal(second.metadata?.tokens, 11);

  const shown = storage.getMessages(chat.id, 50);
  assert.deepEqual(
    shown.map((item) => item.content),
    ["name the tree", "answer 2"]
  );

  const group = agent.listVariants(first.id);
  assert.equal(group.length, 2);
  assert.deepEqual(
    group.map((item) => item.content),
    ["answer 1", "answer 2"]
  );
});

test("switching to the other answer puts it back on screen", async () => {
  const chat = start("Switch");
  const first = await agent.processUserMessage(chat.id, "pick one");
  assert.ok(first);
  await agent.regenerate(chat.id);

  agent.selectVariant(chat.id, first.id);
  const shown = storage.getMessages(chat.id, 50);
  assert.deepEqual(
    shown.map((item) => item.content),
    ["pick one", "answer 1"]
  );
});

test("editing a question drops the turns after it and asks again", async () => {
  const chat = start("Edit");
  await agent.processUserMessage(chat.id, "first question");
  await agent.processUserMessage(chat.id, "second question");

  const second = storage.getMessages(chat.id, 50).find((item) => item.content === "second question");
  assert.ok(second);

  const answer = await agent.editAndResend(chat.id, second.id, "edited question");
  assert.ok(answer);

  const shown = storage.getMessages(chat.id, 50);
  assert.deepEqual(
    shown.map((item) => item.content),
    ["first question", "answer 1", "edited question", "answer 3"]
  );
  assert.equal(answer.metadata?.tokens, 11);
});

test("editing an answer is refused, and so is an empty rewrite", async () => {
  const chat = start("Guards");
  const answer = await agent.processUserMessage(chat.id, "a question");
  assert.ok(answer);

  await assert.rejects(
    () => agent.editAndResend(chat.id, answer.id, "not allowed"),
    /question you sent/i
  );
  await assert.rejects(
    () => agent.editAndResend(chat.id, "no_such_message", "hello"),
    /question you sent/i
  );
});

test("a branch copies the chat up to one message into a conversation of its own", async () => {
  const chat = start("Branch");
  await agent.processUserMessage(chat.id, "first question");
  const answer = await agent.processUserMessage(chat.id, "second question");
  assert.ok(answer);

  const branch = agent.branchConversation(chat.id, answer.id, "Branch (branch)");
  assert.ok(branch);
  assert.equal(branch.title, "Branch (branch)");

  const copied = storage.getMessages(branch.id, 50);
  assert.deepEqual(
    copied.map((item) => item.content),
    ["first question", "answer 1", "second question", "answer 2"]
  );
  assert.equal(storage.getMessages(chat.id, 50).length, 4);
});
