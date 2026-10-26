'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Card, Chip, Empty, ErrorNote, Loading, PageHeader } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { fmtDate, humanize } from '@/lib/format';
import type { Notification } from '@/lib/types';

interface AlertRow { id: number; kind: string; level: number; severity: 'warning' | 'critical'; message: string; created_at: string; entity_type: string; entity_id: number }
interface RuleRow { id: number; kind: string; level: number; after_hours: string; notify_role: string; email: boolean; enabled: boolean }
interface Mail { id: number; to_email: string; subject: string; status: string; created_at: string; sent_at: string | null }

const sevTone = (s: string) => (s === 'critical' ? 'bad' : s === 'warning' ? 'warn' : 'neutral') as 'bad' | 'warn' | 'neutral';
const sevIcon = (s: string) => (s === 'critical' ? '✕' : s === 'warning' ? '!' : 'i');

export default function AlertsPage() {
  const user = useUser();
  const staff = user.role !== 'institution';
  const isAdmin = user.role === 'admin';
  const [tab, setTab] = useState<'inbox' | 'log' | 'rules' | 'email'>('inbox');
  const inbox = useApi<{ unread: number; items: Notification[] }>('/notifications', 15000);
  const log = useApi<AlertRow[]>(staff && tab === 'log' ? '/alerts' : null);
  const rules = useApi<RuleRow[]>(isAdmin && tab === 'rules' ? '/alerts/escalation-rules' : null);
  const mail = useApi<Mail[]>(isAdmin && tab === 'email' ? '/alerts/emails' : null, 10000);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function markAll() { await api('/notifications/read-all', { method: 'POST' }); await inbox.reload(); }
  async function scan() {
    setErr(null); setMsg(null);
    try { const r = await api<{ sla: number; expiring: number; missingDocs: number }>('/alerts/scan', { method: 'POST' }); setMsg(`Scan finished. New alerts: SLA ${r.sla}, expiring approvals ${r.expiring}, missing documents ${r.missingDocs}.`); await inbox.reload(); await log.reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function patchRule(r: RuleRow, patch: Partial<RuleRow>) {
    await api(`/alerts/escalation-rules/${r.id}`, { method: 'PATCH', json: { after_hours: patch.after_hours !== undefined ? Number(patch.after_hours) : undefined, enabled: patch.enabled, email: patch.email } });
    await rules.reload();
  }

  const tabs: [typeof tab, string, boolean][] = [['inbox', 'My notifications', true], ['log', 'Alert log', staff], ['rules', 'Escalation rules', isAdmin], ['email', 'Email outbox (stub)', isAdmin]];

  return (
    <>
      <PageHeader title="Alerts & notifications" subtitle="SLA breaches, expiring approvals and missing documents, escalated by rule."
        action={isAdmin ? <button className="btn-ghost" onClick={() => void scan()}>▶ Run alert scan now</button> : undefined} />
      {msg && <div className="mb-3 rounded-lg bg-good-soft px-3 py-2 text-sm text-good-text">✓ {msg}</div>}
      <ErrorNote message={err} />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-line" role="tablist">
        {tabs.filter(([, , show]) => show).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-brand font-medium text-brand' : 'border-transparent text-ink2'}`}>{label}</button>
        ))}
      </div>

      {tab === 'inbox' && (
        <Card title={`Inbox${inbox.data ? ` (${inbox.data.unread} unread)` : ''}`} action={<button className="text-xs text-brand hover:underline" onClick={() => void markAll()}>Mark all read</button>}>
          {inbox.loading && <Loading />}
          {inbox.data?.items.length === 0 && <Empty>No notifications.</Empty>}
          <ul className="divide-y divide-line">
            {inbox.data?.items.map((n) => (
              <li key={n.id} className={`flex gap-3 py-3 ${n.read_at ? 'opacity-70' : ''}`}>
                <Chip tone={sevTone(n.severity)} icon={sevIcon(n.severity)}>{n.severity}</Chip>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">{n.link ? <Link className="hover:underline" href={n.link} onClick={() => void api(`/notifications/${n.id}/read`, { method: 'POST' })}>{n.title}</Link> : n.title}</div>
                  <div className="text-ink2">{n.body}</div>
                  <div className="mt-0.5 text-xs text-muted">{humanize(n.kind)} · {fmtDate(n.created_at)}</div>
                </div>
                {!n.read_at && <span className="mt-1 h-2 w-2 rounded-full bg-brand" aria-label="unread" />}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'log' && (
        <Card title="Alert log (deduplicated, one row per escalation level)">
          {log.loading && <Loading />}
          <div className="overflow-x-auto"><table className="w-full min-w-[640px]">
            <thead><tr><th className="th">When</th><th className="th">Kind</th><th className="th">Level</th><th className="th">Message</th></tr></thead>
            <tbody className="divide-y divide-line">
              {log.data?.map((a) => (
                <tr key={a.id}><td className="td whitespace-nowrap text-xs text-ink2">{fmtDate(a.created_at)}</td>
                  <td className="td"><Chip tone={sevTone(a.severity)} icon={sevIcon(a.severity)}>{humanize(a.kind)}</Chip></td>
                  <td className="td">L{a.level}</td>
                  <td className="td">{a.entity_type === 'application' ? <Link className="hover:underline" href={`/applications/${a.entity_id}`}>{a.message}</Link> : a.message}</td></tr>
              ))}
            </tbody></table></div>
        </Card>
      )}

      {tab === 'rules' && (
        <Card title="Escalation rules">
          <p className="mb-3 text-xs text-ink2">SLA breach and missing documents: hours after the due time / since the stage began. Approval expiring: hours <i>before</i> expiry. Each level fires once.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[640px]">
            <thead><tr><th className="th">Kind</th><th className="th">Level</th><th className="th">After (hours)</th><th className="th">Notify</th><th className="th">Email</th><th className="th">Enabled</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rules.data?.map((r) => (
                <tr key={r.id}><td className="td">{humanize(r.kind)}</td><td className="td">L{r.level}</td>
                  <td className="td"><input className="input !w-24 !py-1" type="number" defaultValue={Number(r.after_hours)} onBlur={(e) => Number(e.target.value) !== Number(r.after_hours) && void patchRule(r, { after_hours: e.target.value as unknown as string })} /></td>
                  <td className="td">{humanize(r.notify_role)}</td>
                  <td className="td"><input type="checkbox" aria-label="email" checked={r.email} onChange={(e) => void patchRule(r, { email: e.target.checked })} /></td>
                  <td className="td"><input type="checkbox" aria-label="enabled" checked={r.enabled} onChange={(e) => void patchRule(r, { enabled: e.target.checked })} /></td></tr>
              ))}
            </tbody></table></div>
        </Card>
      )}

      {tab === 'email' && (
        <Card title="Email outbox (stub: messages are queued by BullMQ and logged, never actually sent)">
          {mail.data?.length === 0 && <Empty>No emails queued yet.</Empty>}
          <ul className="divide-y divide-line text-sm">
            {mail.data?.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Chip tone={m.status === 'sent' ? 'good' : 'warn'} icon={m.status === 'sent' ? '✓' : '…'}>{m.status}</Chip>
                <span className="font-medium">{m.subject}</span><span className="text-ink2">→ {m.to_email}</span><span className="ml-auto text-xs text-muted">{fmtDate(m.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
