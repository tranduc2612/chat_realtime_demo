import client, { API_BASE } from './client';
import type { BotConversation, BotMessage, Citation } from '../types';

export async function getBotConversations(): Promise<BotConversation[]> {
  const { data } = await client.get<BotConversation[]>('/bot/conversations');
  return data;
}

export async function createBotConversation(title?: string): Promise<BotConversation> {
  const { data } = await client.post<BotConversation>('/bot/conversations', { title: title ?? null });
  return data;
}

export async function deleteBotConversation(id: string): Promise<void> {
  await client.delete(`/bot/conversations/${id}`);
}

export async function getBotMessages(conversationId: string): Promise<BotMessage[]> {
  const { data } = await client.get<BotMessage[]>(`/bot/conversations/${conversationId}/messages`);
  return data;
}

/** Events the /ask endpoint emits, in order: citations → delta* → done. */
export interface AskHandlers {
  onCitations?: (citations: Citation[]) => void;
  onDelta?: (text: string) => void;
  onDone?: (info: {
    message_id: string | null;
    created_at: string | null;
    failed: boolean;
    prompt_tokens: number | null;
    completion_tokens: number | null;
  }) => void;
  onError?: (detail: string) => void;
}

/**
 * Ask a question and stream the answer back.
 *
 * Uses `fetch` rather than the shared axios client because the browser's
 * XMLHttpRequest cannot expose a response body incrementally — and EventSource
 * is not an option either, since it can't send an Authorization header.
 */
export async function askBot(
  conversationId: string,
  question: string,
  handlers: AskHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem('access_token');

  const response = await fetch(`${API_BASE}/bot/conversations/${conversationId}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ question }),
    signal,
  });

  if (!response.ok || !response.body) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : detail;
    } catch {
      /* non-JSON error body — keep the status-code message */
    }
    handlers.onError?.(detail);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line. A frame can arrive split
    // across reads, so anything after the last separator stays buffered.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const payload = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (!payload) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }

      switch (event.type) {
        case 'citations':
          handlers.onCitations?.((event.citations ?? []) as Citation[]);
          break;
        case 'delta':
          handlers.onDelta?.(String(event.content ?? ''));
          break;
        case 'error':
          handlers.onError?.(String(event.detail ?? 'The assistant failed.'));
          break;
        case 'done':
          handlers.onDone?.(event as unknown as Parameters<NonNullable<AskHandlers['onDone']>>[0]);
          break;
      }
    }
  }
}
