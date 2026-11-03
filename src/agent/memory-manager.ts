import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { allowedRoots, config } from "../utils/config";
import storage from "../utils/storage";
import logger from "../utils/logger";
import { parseCitation } from "../utils/citations";
import { resolveInWorkspace } from "./tools/paths";
import type {
  CitationPreview,
  MemoryFact,
  MemorySnapshot,
  MemorySummary,
  WorkspaceHit,
  WorkspaceIndexStatus,
} from "../utils/types";

const MAX_FACTS = 50;
const MAX_FACT_CHARS = 500;
const PROMPT_FACTS = 12;
const PROMPT_FACTS_CHARS = 3_000;
const MAX_SUMMARY_CHARS = 600;
const PROMPT_DIGESTS = 4;
const CITATION_CONTEXT_LINES = 6;
const MAX_FILES = 1_200;
const MAX_CHUNKS = 3_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const CHUNK_LINES = 40;
const OVERLAP_LINES = 8;
const MAX_CHUNK_CHARS = 4_000;
const MAX_EXCERPT_CHARS = 1_500;
const MAX_RESULT_CHARS = 6_000;
const MAX_CONTEXT_HITS = 2;
const MAX_CONTEXT_EXCERPT = 700;
const WORKSPACE_INTENT =
  /\b(workspace|file|files|folder|project|repo|codebase|document|documents|docs|notes?|readme)\b/i;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "Library",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  "vendor",
  "Pods",
  "models",
  "Applications",
  "System",
  "Volumes",
  "private",
]);

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".rst",
  ".json",
  ".jsonc",
  ".csv",
  ".tsv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".sql",
  ".sh",
  ".zsh",
  ".bash",
  ".log",
]);

const SECRET_FILE = /^(\.env(\..+)?|\.?id_(rsa|dsa|ecdsa|ed25519)|.*\.(pem|key|p12|pfx|jks|keystore|keychain))$/i;

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that", "from",
  "have", "has", "was", "were", "will", "would", "can", "could", "should", "about", "into",
  "when", "what", "how", "why", "where", "who", "which", "a", "an", "of", "to", "in", "on",
  "at", "is", "it", "as", "be", "or", "if", "i", "me", "my", "we", "our", "they", "their",
  "them", "do", "does", "did", "so", "than", "then", "there", "here", "also", "just", "very",
  "please", "find", "show", "tell", "give",
]);

interface Chunk {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  tokens: Map<string, number>;
  tokenCount: number;
}

const normalizeFact = (content: string): string => content.replace(/\s+/g, " ").trim();

const clip = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit).trim()}…` : text;

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));

const countTokens = (text: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
};

/**
 * Facts are user-pinned and encrypted in SQLite. Conversation digests are computed
 * when the prompt is built, and the workspace index lives in memory only, so
 * disabling memory leaves no derived index on disk.
 */
export class MemoryManager {
  private chunks: Chunk[] = [];
  private files = 0;
  private bytes = 0;
  private builtAt?: Date;
  private error?: string;
  private building: Promise<void> | null = null;
  private generation = 0;

  getFacts(): MemoryFact[] {
    return storage.getMemoryFacts();
  }

  addFact(content: string): MemoryFact {
    const text = normalizeFact(content);
    if (!text) throw new Error("Write a fact before saving it");
    if (text.length > MAX_FACT_CHARS) throw new Error(`Facts are limited to ${MAX_FACT_CHARS} characters`);
    if (storage.getMemoryFacts(MAX_FACTS + 1).length >= MAX_FACTS) {
      throw new Error(`Remove a fact first. Memory holds ${MAX_FACTS} pinned facts.`);
    }
    const fact = storage.addMemoryFact(text);
    logger.info("memory.fact.added", { id: fact.id });
    return fact;
  }

  deleteFact(id: string): void {
    storage.deleteMemoryFact(id);
    logger.info("memory.fact.deleted", { id });
  }

  /** Rewrites a fact in place; its id and the citations that name it stay valid. */
  editFact(id: string, content: string): MemoryFact {
    const text = normalizeFact(content);
    if (!text) throw new Error("Write a fact before saving it");
    if (text.length > MAX_FACT_CHARS) throw new Error(`Facts are limited to ${MAX_FACT_CHARS} characters`);
    const fact = storage.updateMemoryFact(id, text);
    if (!fact) throw new Error("That fact is no longer there");
    logger.info("memory.fact.edited", { id });
    return fact;
  }

  clearFacts(): void {
    storage.clearMemoryFacts();
    logger.info("memory.facts.cleared");
  }

  /**
   * What the model remembers about each conversation. The digest is derived from the
   * stored messages; the summary the user wrote wins over it, so a curated note
   * replaces the extract rather than sitting beside it.
   */
  summaries(): MemorySummary[] {
    const written = new Map(storage.getMemorySummaries().map((summary) => [summary.conversationId, summary]));
    return storage
      .listConversations()
      .filter((conversation) => conversation.messageCount >= 2)
      .map((conversation) => {
        const derived = this.deriveDigest(conversation.id, conversation.messageCount);
        const edited = written.get(conversation.id);
        return {
          conversationId: conversation.id,
          title: conversation.title,
          messageCount: conversation.messageCount,
          derived,
          content: edited?.content ?? derived,
          edited: Boolean(edited?.content),
          recall: conversation.recall,
          updatedAt: edited?.updatedAt ?? conversation.updatedAt,
        };
      });
  }

  /** Stores the user's own summary for a conversation; it replaces the derived digest. */
  editSummary(conversationId: string, content: string): void {
    const text = normalizeFact(content);
    if (!text) throw new Error("Write a summary before saving it");
    if (text.length > MAX_SUMMARY_CHARS) {
      throw new Error(`Summaries are limited to ${MAX_SUMMARY_CHARS} characters`);
    }
    if (!storage.getConversation(conversationId)) throw new Error("That conversation is no longer there");
    storage.upsertMemorySummary(conversationId, text);
    logger.info("memory.summary.edited", { conversationId });
  }

  /** Forgets a conversation: the written summary goes and recall is turned off. */
  forgetSummary(conversationId: string): void {
    storage.deleteMemorySummary(conversationId);
    storage.setConversationRecall(conversationId, false);
    logger.info("memory.summary.forgotten", { conversationId });
  }

  /** Turns recall on or off for one conversation; the summary stays where it is. */
  setRecall(conversationId: string, recall: boolean): void {
    storage.setConversationRecall(conversationId, recall);
    logger.info("memory.recall.set", { conversationId, recall });
  }

  private deriveDigest(conversationId: string, messageCount: number): string {
    const messages = storage.getMessages(conversationId, 10);
    const users = messages.filter((message) => message.role === "user");
    const first = users[0];
    const latest = users.slice(-2);
    const lastAnswer = [...messages].reverse().find((message) => message.role === "assistant");
    const parts: string[] = [];
    if (first) parts.push(`Earlier: "${clip(normalizeFact(first.content), 120)}"`);
    if (latest.length) {
      parts.push(
        `Recently: ${latest.map((message) => `"${clip(normalizeFact(message.content), 90)}"`).join(" / ")}`
      );
    }
    if (lastAnswer) parts.push(`Last answer: "${clip(normalizeFact(lastAnswer.content), 120)}"`);
    if (!parts.length) parts.push(`${messageCount} messages`);
    return parts.join(" · ").slice(0, 460);
  }

  /**
   * Resolves a citation to the source behind it, so the user can check what the
   * model leaned on. A file is read from disk and confined to the allowed folders;
   * a path the model made up resolves to nothing rather than to the real file.
   */
  async citationPreview(label: string): Promise<CitationPreview> {
    const citation = parseCitation(label);
    if (!citation) {
      return { kind: "fact", label, title: "Not a citation", text: "", found: false };
    }

    if (citation.kind === "fact") {
      const fact = storage
        .getMemoryFacts(200)
        .find((entry) => entry.id === citation.id || entry.id.endsWith(citation.id));
      if (!fact) {
        return {
          kind: "fact",
          label,
          title: "Fact not found",
          text: "That fact was deleted, or the answer cited one that never existed.",
          found: false,
        };
      }
      return {
        kind: "fact",
        label,
        title: `Pinned fact · ${fact.createdAt.toISOString().slice(0, 10)}`,
        text: fact.content,
        found: true,
      };
    }

    if (citation.kind === "chat") {
      const summary = this.summaries().find((entry) => entry.title === citation.title);
      if (!summary) {
        return {
          kind: "chat",
          label,
          title: citation.title,
          text: "That conversation is gone, so there is nothing left to recall.",
          found: false,
        };
      }
      return {
        kind: "chat",
        label,
        title: summary.title,
        text: summary.content,
        found: true,
      };
    }

    try {
      const resolved = await resolveInWorkspace(citation.path);
      const lines = (await fs.readFile(resolved, "utf8")).split(/\r?\n/);
      const start = Math.max(0, citation.line - 1 - CITATION_CONTEXT_LINES);
      const end = Math.min(lines.length, citation.line + CITATION_CONTEXT_LINES);
      return {
        kind: "file",
        label,
        title: path.basename(resolved),
        text: lines.slice(start, end).join("\n"),
        path: resolved,
        startLine: start + 1,
        endLine: end,
        found: true,
      };
    } catch (error) {
      logger.warn("memory.citation.unreadable", { path: citation.path, error });
      return {
        kind: "file",
        label,
        title: path.basename(citation.path),
        text: "That passage could not be read. It may be outside the folders the agent may read, or the file has changed.",
        path: citation.path,
        found: false,
      };
    }
  }

  /** Facts and cross-chat digests are stable during a conversation unless the user edits them. */
  promptSection(activeConversationId: string | null): string {
    if (!this.enabled) return "";
    const sections: string[] = [];

    const facts = storage.getMemoryFacts(PROMPT_FACTS);
    if (facts.length) {
      const lines: string[] = [];
      let used = 0;
      for (const fact of facts) {
        const line = `- [fact:${fact.id.slice(-6)}] ${fact.content} (${fact.createdAt.toISOString().slice(0, 10)})`;
        if (used + line.length > PROMPT_FACTS_CHARS) break;
        lines.push(line);
        used += line.length;
      }
      sections.push(`Pinned facts from the user (cite as [fact:<id>]):\n${lines.join("\n")}`);
    }

    const digests = this.summaries()
      .filter((summary) => summary.recall && summary.conversationId !== activeConversationId)
      .slice(0, PROMPT_DIGESTS);
    if (digests.length) {
      const lines = digests.map((digest) => `- [chat "${digest.title}"] ${digest.content}`);
      sections.push(`Recent conversation digests (cite as [chat "<title>"]):\n${lines.join("\n")}`);
    }

    return sections.length ? `\n\n${sections.join("\n\n")}` : "";
  }

  status(): WorkspaceIndexStatus {
    const enabled = this.enabled && Boolean(config.get("memory")?.workspaceSearch);
    return {
      state: this.building ? "building" : this.error ? "error" : this.builtAt ? "ready" : "idle",
      enabled,
      files: this.files,
      chunks: this.chunks.length,
      bytes: this.bytes,
      builtAt: this.builtAt,
      error: this.error,
    };
  }

  snapshot(): MemorySnapshot {
    return {
      facts: this.getFacts(),
      summaries: this.summaries(),
      workspace: this.status(),
    };
  }

  clearIndex(): WorkspaceIndexStatus {
    this.generation++;
    this.chunks = [];
    this.files = 0;
    this.bytes = 0;
    this.builtAt = undefined;
    this.error = undefined;
    return this.status();
  }

  async rebuild(): Promise<WorkspaceIndexStatus> {
    if (!this.enabled || !config.get("memory")?.workspaceSearch) return this.status();
    if (this.building) {
      await this.building;
      return this.status();
    }

    const generation = ++this.generation;
    this.chunks = [];
    this.files = 0;
    this.bytes = 0;
    this.builtAt = undefined;
    this.error = undefined;
    this.building = this.walkRoots(generation);
    try {
      await this.building;
      if (generation !== this.generation) return this.status();
      this.builtAt = new Date();
      logger.info("memory.index.ready", { files: this.files, chunks: this.chunks.length, bytes: this.bytes });
    } catch (error) {
      if (generation === this.generation) {
        this.error = error instanceof Error ? error.message : "Workspace index failed";
        logger.error("memory.index.failed", { error: this.error });
      }
    } finally {
      this.building = null;
    }
    return this.status();
  }

  async search(query: string, limit = 4): Promise<WorkspaceHit[]> {
    if (!this.enabled || !config.get("memory")?.workspaceSearch) {
      throw new Error("Workspace memory is off. Enable it in Settings → Memory.");
    }
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    if (!this.builtAt || this.building) await this.rebuild();
    if (this.error) throw new Error(this.error);

    const scored: Array<{ chunk: Chunk; score: number }> = [];
    for (const chunk of this.chunks) {
      let matched = 0;
      let score = 0;
      const lowerPath = chunk.path.toLowerCase();
      for (const term of terms) {
        const frequency = chunk.tokens.get(term) ?? 0;
        if (frequency) {
          matched++;
          score += 1 + Math.log(frequency);
        }
        if (lowerPath.includes(term)) score += 0.6;
      }
      if (!matched) continue;
      score *= 1 + matched / terms.length;
      score /= Math.sqrt(1 + chunk.tokenCount / 120);
      scored.push({ chunk, score });
    }

    scored.sort((left, right) => right.score - left.score);
    const hits: WorkspaceHit[] = [];
    const seen = new Set<string>();
    for (const { chunk, score } of scored) {
      if (seen.has(chunk.path)) continue;
      seen.add(chunk.path);
      hits.push({
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        excerpt:
          chunk.text.length > MAX_EXCERPT_CHARS
            ? `${chunk.text.slice(0, MAX_EXCERPT_CHARS).trimEnd()}\n…`
            : chunk.text,
        score: Math.round(score * 1000) / 1000,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  async execute(action: string, args: Record<string, unknown>): Promise<string> {
    if (action === "search_workspace") return await this.searchTool(String(args.query ?? ""));
    throw new Error(`Unknown memory action: ${action}`);
  }

  /**
   * Retrieved excerpts for the current turn, added to the user prompt rather than the
   * system prompt so the GGUF session keeps its KV-cached history.
   */
  async contextFor(message: string): Promise<string> {
    if (!this.enabled || !config.get("memory")?.workspaceSearch) return "";
    if (!WORKSPACE_INTENT.test(message)) return "";
    const hits = await this.search(message, MAX_CONTEXT_HITS).catch((error) => {
      logger.warn("memory.context.failed", { error });
      return [] as WorkspaceHit[];
    });
    if (!hits.length) return "";
    const blocks = hits.map(
      (hit) => `[file:${hit.path}:${hit.startLine}]\n${clip(hit.excerpt, MAX_CONTEXT_EXCERPT)}`
    );
    return `Workspace context retrieved locally. Answer the question from these passages and cite the exact source label. Do not use tools or emit a task block on this turn. If the passages do not answer the question, say so plainly.\n\n${blocks.join("\n\n")}`;
  }

  async searchTool(query: string): Promise<string> {
    if (!this.enabled) throw new Error("Memory is off in Settings → Memory");
    const trimmed = query.trim();
    if (!trimmed) throw new Error("A search query is required");
    const hits = await this.search(trimmed, 4);
    if (!hits.length) {
      return `No workspace passages matched "${trimmed}". The index has ${this.files} files and ${this.chunks.length} passages.`;
    }

    let text = `Workspace passages for "${trimmed}" (lexical index: ${this.files} files, ${this.chunks.length} passages):\n\n`;
    for (const [index, hit] of hits.entries()) {
      const block = `[${index + 1}] ${hit.path}:${hit.startLine}-${hit.endLine}\n${hit.excerpt}\n\n`;
      if (text.length + block.length > MAX_RESULT_CHARS) break;
      text += block;
    }
    return `${text.trimEnd()}\n\nCite as [file:<path>:<line>].`;
  }

  private get enabled(): boolean {
    return Boolean(config.get("memory")?.enabled);
  }

  private async walkRoots(generation: number): Promise<void> {
    // Explicit workspace folders come first so the size caps cannot crowd them out.
    const roots = [
      ...new Set([
        ...(config.get("agent").workspaceRoots ?? []).map((root) => path.resolve(root)),
        ...allowedRoots(),
      ]),
    ];
    const seen = new Set<string>();
    for (const root of roots) {
      if (generation !== this.generation) return;
      await this.walk(root, seen, generation);
      if (this.chunks.length >= MAX_CHUNKS || this.files >= MAX_FILES || this.bytes >= MAX_TOTAL_BYTES) break;
    }
  }

  private async walk(dir: string, seen: Set<string>, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (generation !== this.generation) return;
      if (this.chunks.length >= MAX_CHUNKS || this.files >= MAX_FILES || this.bytes >= MAX_TOTAL_BYTES) return;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) await this.walk(full, seen, generation);
        continue;
      }
      if (!entry.isFile() || seen.has(full)) continue;
      if (entry.name.startsWith(".") || SECRET_FILE.test(entry.name)) continue;
      if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      seen.add(full);
      await this.indexFile(full, generation);
    }
  }

  private async indexFile(file: string, generation: number): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return;
    }
    if (generation !== this.generation) return;
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) return;
    if (this.bytes + stat.size > MAX_TOTAL_BYTES) return;

    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      return;
    }
    if (text.includes("\u0000") || generation !== this.generation) return;

    const lines = text.split(/\r?\n/);
    let added = false;
    for (let start = 0; start < lines.length; start += CHUNK_LINES - OVERLAP_LINES) {
      if (generation !== this.generation) return;
      if (this.chunks.length >= MAX_CHUNKS) break;
      const end = Math.min(lines.length, start + CHUNK_LINES);
      const body = lines.slice(start, end).join("\n").slice(0, MAX_CHUNK_CHARS).trim();
      if (body) {
        const tokens = countTokens(body);
        if (tokens.size) {
          this.chunks.push({
            path: file,
            startLine: start + 1,
            endLine: end,
            text: body,
            tokens,
            tokenCount: [...tokens.values()].reduce((sum, count) => sum + count, 0),
          });
          added = true;
        }
      }
      if (end === lines.length) break;
    }

    if (added) {
      this.files++;
      this.bytes += stat.size;
    }
  }
}
