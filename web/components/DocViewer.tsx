'use client';
import { useEffect, useState } from 'react';
import { fetchBlobUrl } from '@/lib/api';

export default function DocViewer({ appId, doc }: { appId: number; doc: { id: number; filename: string; content_type: string } | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) { setUrl(null); return; }
    let revoked: string | null = null;
    setError(null); setUrl(null);
    fetchBlobUrl(`/applications/${appId}/documents/${doc.id}/file`)
      .then((u) => { revoked = u; setUrl(u); })
      .catch((e: Error) => setError(e.message));
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [appId, doc]);

  if (!doc) return <div className="grid h-72 place-items-center rounded-lg border border-dashed border-line text-sm text-muted">Select a document to preview it here.</div>;
  if (error) return <div className="rounded-lg bg-bad-soft p-4 text-sm text-bad-text">✕ {error}</div>;
  if (!url) return <div className="grid h-72 place-items-center text-sm text-muted">Loading preview…</div>;
  const isImage = doc.content_type.startsWith('image/');
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-ink2">
        <span className="truncate font-medium">{doc.filename}</span>
        <a href={url} target="_blank" rel="noreferrer" className="text-brand hover:underline">Open in new tab ↗</a>
      </div>
      {isImage
        ? <img src={url} alt={doc.filename} className="max-h-[32rem] w-full rounded-lg border border-line object-contain" />
        : <iframe src={url} title={doc.filename} className="h-[32rem] w-full rounded-lg border border-line bg-white" />}
    </div>
  );
}
