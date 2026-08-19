import client from './client';
import type { KnowledgeBaseStats, KnowledgeDocument } from '../types';

/** Admin-only: every uploaded document, newest first. */
export async function getDocuments(): Promise<KnowledgeDocument[]> {
  const { data } = await client.get<KnowledgeDocument[]>('/documents');
  return data;
}

/**
 * Admin-only. Returns immediately with status `pending` — the backend parses,
 * chunks and embeds in the background, so poll `getDocuments` until the row
 * reaches `ready` or `failed`.
 */
export async function uploadDocument(file: File): Promise<KnowledgeDocument> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await client.post<KnowledgeDocument>('/documents', form);
  return data;
}

export async function deleteDocument(id: string): Promise<void> {
  await client.delete(`/documents/${id}`);
}

/** Readable by any signed-in user — drives the "grounded in N documents" hint. */
export async function getKnowledgeBaseStats(): Promise<KnowledgeBaseStats> {
  const { data } = await client.get<KnowledgeBaseStats>('/documents/stats');
  return data;
}
