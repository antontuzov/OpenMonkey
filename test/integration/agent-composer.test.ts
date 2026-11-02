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

const file = (name: string, body: string) => ({ name, bytes: body.length, text: body, kind: "text" as const });

test("every file of a message reaches the model, and the history keeps their names", async () => {
  const chat = start("Attachments");
  const answer = await agent.processUserMessage(chat.id, "compare these", [
    file("one.md", "first body"),
    file("two.md", "second body"),
  ]);
  assert.ok(answer);

  const prompt = model.prompts[0];
  assert.match(prompt, /first body/);
  assert.match(prompt, /second body/);
  assert.match(prompt, /compare these/);

  const question = storage.getMessages(chat.id, 50).find((item) => item.role === "user");
  assert.ok(question);
  assert.deepEqual(
    question.metadata?.attachments?.map((item) => item.name),
    ["one.md", "two.md"]
  );
});

test("the files of a message survive a round trip through the database", async () => {
  const chat = start("Attachments stored");
  await agent.processUserMessage(chat.id, "read them", [file("one.md", "body"), file("two.md", "body")]);

  const question = storage.getMessages(chat.id, 50).find((item) => item.role === "user");
  assert.ok(question);
  assert.equal(question.metadata?.attachments?.length, 2);
  assert.equal(question.metadata?.attachments?.[1]?.name, "two.md");
});

test("a message with only files still says something", async () => {
  const chat = start("Files only");
  const answer = await agent.processUserMessage(chat.id, "", [file("one.md", "body")]);
  assert.ok(answer);
  const question = storage.getMessages(chat.id, 50).find((item) => item.role === "user");
  assert.equal(question?.content, "Attached one.md");
});

test("an image is named to the model, and never decoded", async () => {
  const chat = start("Image");
  await agent.processUserMessage(chat.id, "what is this?", [
    { name: "shot.png", bytes: 2048, text: "", kind: "image" },
  ]);
  const prompt = model.prompts[0];
  assert.match(prompt, /shot\.png/);
  assert.match(prompt, /read text only/);
});

test("clearing a chat empties it but keeps the chat itself", async () => {
  const chat = start("Clear");
  await agent.processUserMessage(chat.id, "a question");
  await agent.processUserMessage(chat.id, "another question");
  assert.equal(storage.getMessages(chat.id, 50).length, 4);

  const removed = agent.clearConversation(chat.id);
  assert.equal(removed, 4);
  assert.equal(storage.getMessages(chat.id, 50).length, 0);
  assert.ok(storage.getConversation(chat.id));
});

test("summarizing a chat answers with the model's own digest", async () => {
  const chat = start("Summarize");
  await agent.processUserMessage(chat.id, "what is the plan?");
  await agent.processUserMessage(chat.id, "ship it on Friday");

  const summary = await agent.summarizeConversation(chat.id);
  assert.ok(summary);
  assert.equal(summary.role, "assistant");
  assert.equal(summary.content, "answer 3");

  // The digest is saved like any other answer, so the chat keeps it.
  const shown = storage.getMessages(chat.id, 50);
  assert.equal(shown[shown.length - 1].content, "answer 3");
});

test("summarizing an empty chat is refused instead of inventing one", async () => {
  const chat = start("Summarize empty");
  await assert.rejects(() => agent.summarizeConversation(chat.id), /nothing to summarize/i);
});
