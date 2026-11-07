import type { Conversation } from "./types";

/** How many chats the tray lists; a longer list is a menu nobody reads. */
export const RECENT_CHATS_LIMIT = 6;

/** A menu row has to stay on one line, so a long title is cut short. */
const LABEL_LIMIT = 48;

export interface RecentChat {
  id: string;
  title: string;
}

export function chatLabel(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= LABEL_LIMIT) return trimmed;
  return `${trimmed.slice(0, LABEL_LIMIT - 1)}…`;
}

/**
 * The chats the tray offers: the pinned ones first, then the ones touched last.
 * A quick ask is not a chat yet, and an archived chat is out of sight.
 */
export function recentChats(conversations: Conversation[], limit = RECENT_CHATS_LIMIT): RecentChat[] {
  return [...conversations]
    .filter((conversation) => conversation.kind === "chat" && !conversation.archived)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.updatedAt.getTime() - a.updatedAt.getTime()
    )
    .slice(0, limit)
    .map((conversation) => ({ id: conversation.id, title: chatLabel(conversation.title) }));
}
