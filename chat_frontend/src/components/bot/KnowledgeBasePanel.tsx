import { useEffect, useRef, useState } from 'react';
import {
  CheckCircleIcon,
  CircleNotchIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { deleteDocument, getDocuments, uploadDocument } from '../../api/documents';
import { useBotStore } from '../../stores/botStore';
import { useThemeStore } from '../../stores/themeStore';
import type { KnowledgeDocument } from '../../types';

const ACCEPTED = '.pdf,.docx,.md,.markdown,.txt,.html,.htm';
/** How often to re-check documents that are still being embedded. */
const POLL_MS = 2000;

interface Props {
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function StatusBadge({ document: doc }: { document: KnowledgeDocument }) {
  if (doc.status === 'ready') {
    return (
      <span className="flex items-center gap-1 text-green-500">
        <CheckCircleIcon size={13} weight="fill" />
        {doc.chunk_count} chunks
      </span>
    );
  }
  if (doc.status === 'failed') {
    return (
      <span className="flex items-center gap-1 text-red-500" title={doc.error ?? undefined}>
        <WarningCircleIcon size={13} weight="fill" />
        Failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-amber-500">
      <CircleNotchIcon size={13} className="animate-spin" />
      {doc.status === 'processing' ? 'Indexing' : 'Queued'}
    </span>
  );
}

export default function KnowledgeBasePanel({ onClose }: Props) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme } = useThemeStore();
  const { fetchStats } = useBotStore();
  const isDark = theme === 'dark';

  const refresh = async () => {
    try {
      setDocuments(await getDocuments());
      // Keeps the "grounded in N documents" header behind this modal in sync
      // as chunks finish embedding.
      fetchStats();
    } catch {
      setError('Could not load the knowledge base.');
    }
  };

  // Written as an explicit promise chain rather than `refresh()` so the state
  // updates land in a callback instead of the effect body.
  useEffect(() => {
    getDocuments()
      .then((docs) => {
        setDocuments(docs);
        fetchStats();
      })
      .catch(() => setError('Could not load the knowledge base.'));
  }, []);

  // Ingestion happens in a background task, so poll while anything is in
  // flight and stop as soon as everything has settled.
  useEffect(() => {
    const pending = documents.some((d) => d.status === 'pending' || d.status === 'processing');
    if (!pending) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [documents]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadDocument(file);
      }
      await refresh();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDocument(id);
      await refresh();
    } catch {
      setError('Could not delete that document.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Knowledge base"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: isDark ? '#1e293b' : '#ffffff' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}` }}
        >
          <div>
            <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-slate-800'}`}>Knowledge base</h2>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
              Documents the assistant is allowed to answer from
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className={`w-8 h-8 flex items-center justify-center rounded-xl transition ${
              isDark ? 'text-white/40 hover:bg-white/10' : 'text-slate-400 hover:bg-slate-100'
            }`}
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="px-5 py-4">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={`w-full flex flex-col items-center justify-center gap-1.5 py-6 rounded-xl border-2 border-dashed transition disabled:opacity-50 ${
              isDark
                ? 'border-white/15 text-white/50 hover:border-primary/50 hover:text-white/80'
                : 'border-slate-200 text-slate-400 hover:border-brand-strong/50 hover:text-slate-600'
            }`}
          >
            {uploading ? (
              <CircleNotchIcon size={22} className="animate-spin" />
            ) : (
              <UploadSimpleIcon size={22} />
            )}
            <span className="text-sm font-medium">
              {uploading ? 'Uploading…' : 'Upload internal documents'}
            </span>
            <span className="text-xs">PDF, DOCX, Markdown, TXT or HTML</span>
          </button>

          {error && (
            <p className="mt-3 text-xs text-red-500 flex items-center gap-1.5">
              <WarningCircleIcon size={13} weight="fill" />
              {error}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin px-5 pb-5">
          {documents.length === 0 ? (
            <p className={`text-center text-sm py-8 ${isDark ? 'text-white/25' : 'text-slate-300'}`}>
              No documents yet. The assistant has nothing to answer from.
            </p>
          ) : (
            <div className="space-y-1.5">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{
                    background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc',
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}`,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${isDark ? 'text-white/85' : 'text-slate-700'}`}>
                      {doc.filename}
                    </p>
                    <p className="text-xs mt-0.5 flex items-center gap-2">
                      <StatusBadge document={doc} />
                      <span className={isDark ? 'text-white/25' : 'text-slate-300'}>
                        {formatSize(doc.file_size)}
                      </span>
                    </p>
                    {doc.status === 'failed' && doc.error && (
                      <p className="text-[11px] mt-1 text-red-400/80 break-words">{doc.error}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    title="Delete document"
                    aria-label={`Delete ${doc.filename}`}
                    className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition ${
                      isDark
                        ? 'text-white/35 hover:text-red-400 hover:bg-red-400/10'
                        : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                    }`}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
