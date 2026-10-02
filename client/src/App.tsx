import { useCallback, useEffect, useMemo, useState } from 'react';

type Project = { id: string; title: string; status: string; deliveryDate: string };
type TimelineEntry = { action: 'submit' | 'approve' | 'reject' | 'resubmit'; actor: string; comment: string; at: string };
type Approval = { id: string; entityType: string; entityId: string; title: string; status: 'pending' | 'approved' | 'rejected'; approver: string; requestedBy: string; comment?: string; revision: number; timeline: TimelineEntry[] };
type AuditItem = { id: string; action: string; entity: string; entityId: string; actor: string; at: string; details: string; revision?: number };
type Summary = { planned: number; forecast: number; actual: number; variance: number; utilization: number; committed: number; contractExposure: number; assetCount: number; pendingApprovals: number; rejectedApprovals: number; highRiskLines: { subcategory: string; forecast: number; planned: number }[]; lines: { id: string; category: string; subcategory: string; planned: number; committed: number; forecast: number; actual: number; risk: string }[]; contracts: { vendor: string; scope: string; committed: number; paid: number; milestones: { name: string; due: string; status: string }[] }[]; assets: { id: string; name: string; type: string; version: number; status: string; availableTo: string }[]; approvals: Approval[]; project: Project };
type Conflict = { severity: string; assetA: string; assetB: string; reason: string };

const money = (n: number) => `¥${((n || 0) / 10000).toFixed(0)}万`;
const api = '/api';
const ACTION_LABEL: Record<TimelineEntry['action'], string> = { submit: '首次提交', resubmit: '修改重提', approve: '通过', reject: '驳回' };
const formatAt = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? at.slice(0, 16).replace('T', ' ') : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }

async function request<T>(path: string, init?: RequestInit, retry = 1): Promise<T> {
  try {
    const response = await fetch(`${api}${path}`, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(body.message || `请求失败 (${response.status})`, response.status, body.code);
    return body as T;
  } catch (reason) {
    // GET 网络抖动允许静默重试；写操作不自动重试，避免重复通过/驳回（服务端 409 已兜底双击）。
    const isNetworkError = reason instanceof TypeError;
    if (retry > 0 && (!init || (init.method ?? 'GET') === 'GET') && isNetworkError) return request<T>(path, init, retry - 1);
    throw reason;
  }
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('PRJ-001');
  const [summary, setSummary] = useState<Summary>();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [tab, setTab] = useState<'overview' | 'budget' | 'rights'>('overview');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  // silent=true 为操作后的刷新：不闪全屏 loading、不弹错，失败由调用方决定提示，保证待办/风险/审计一致。
  const load = useCallback(async (id = 'PRJ-001', silent = false): Promise<boolean> => {
    if (!silent) { setLoading(true); setError(''); }
    try {
      const items = await request<Project[]>('/projects');
      const active = items.find(item => item.id === id) ?? items[0];
      if (!active) throw new Error('服务端没有返回项目数据');
      const [s, c, a] = await Promise.all([
        request<Summary>(`/projects/${active.id}/summary`),
        request<Conflict[]>(`/projects/${active.id}/rights-conflicts`),
        request<AuditItem[]>(`/approvals/audit?projectId=${active.id}`),
      ]);
      setProjects(items); setSelected(active.id); setSummary(s); setConflicts(c); setAudit(a);
      return true;
    } catch (reason) {
      if (!silent) setError(reason instanceof Error ? reason.message : '无法连接制作服务');
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 写操作闭环：成功必须在「服务端确认 + 刷新完成」后才提示成功；失败不改动本地状态、按钮恢复可点。
  const runApprovalAction = useCallback(async (approval: Approval, path: string, init: RequestInit, successText: string, cardError: (msg: string) => void) => {
    const actionStartedAt = Date.now();
    setBusyId(approval.id);
    try {
      await request(path, init);
    } catch (reason) {
      setBusyId('');
      if (reason instanceof ApiError && reason.status === 409) {
        setError(reason.message);
        void load(selected, true); // 他人先处理：以服务端终态为准
        return;
      }
      // 网络错误时请求可能已在服务端生效：拉最新审计对账，确认落地才提示成功，否则保留表单让用户重试。
      if (reason instanceof TypeError) {
        const payload = JSON.parse((init.body as string) ?? '{}') as { status?: string };
        const expectAction = path.endsWith('/resubmit') ? 'RESUBMIT' : payload.status === 'rejected' ? 'REJECT' : 'APPROVE';
        const expectRevision = expectAction === 'RESUBMIT' ? approval.revision + 1 : approval.revision;
        const latest = await request<AuditItem[]>(`/approvals/audit?projectId=${selected}`).catch(() => [] as AuditItem[]);
        const startedAt = actionStartedAt - 1000; // 只认点击后产生的事件，避免命中历史同版本记录
        const landed = latest.some(e => e.action === expectAction && e.entityId === approval.entityId && e.revision === expectRevision && new Date(e.at).getTime() >= startedAt);
        await load(selected, true);
        if (landed) { setMessage(successText); return; }
        cardError('网络异常，未能确认操作结果；如服务端未收到请重试');
        return;
      }
      cardError(reason instanceof Error ? reason.message : '操作失败，请重试');
      return;
    }
    const refreshed = await load(selected, true);
    setBusyId('');
    if (refreshed) setMessage(successText);
    else { setError('操作已保存，但刷新最新结果失败，请稍后手动刷新'); void load(selected, true); }
  }, [load, selected]);

  const variancePct = useMemo(() => summary ? Math.round(summary.variance / summary.planned * 100) : 0, [summary]);
  if (loading && !summary) return <main className="connection-state"><div className="loading">正在载入制作控制台…</div><small>正在通过 Vite API 代理连接本地制作服务</small></main>;
  if (!summary) return <main className="connection-state"><h2>无法连接制作服务</h2><p>{error || '服务端没有返回项目数据。'}</p><p>请从项目根目录运行 <code>npm run dev</code>，确认前端 5173 和 API 4104 均已启动。</p><button onClick={() => void load(selected)}>重新连接</button></main>;

  return <main>
    <header><div><div className="eyebrow">STUDIO OPS / RIGHTS & FINANCE CONTROL</div><h1>FrameLedger <span>影视制作预算与资产版权协同</span></h1><p>将预算承诺、供应商付款、资产版本与跨地域版权窗口串成可审计的交付链路。</p></div><div className="header-actions"><select value={selected} onChange={e => { setSelected(e.target.value); void load(e.target.value); }}>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select><span className="live"><i /> LIVE CONTROL</span></div></header>
    {message && <div className="toast" onClick={() => setMessage('')}>{message} ×</div>}
    {error && <div className="toast error-toast" onClick={() => setError('')}>{error} ×</div>}
    <section className="kpis"><div><small>FORECAST COST</small><b>{money(summary.forecast)}</b><span>预算偏差 <em className={summary.variance > 0 ? 'bad' : ''}>{variancePct}%</em></span></div><div><small>COMMITTED</small><b>{money(summary.committed)}</b><span>已锁定供应商与合同</span></div><div><small>ASSET REGISTER</small><b>{summary.assetCount}<em> 个</em></b><span>版本与交付状态纳管</span></div><div><small>RISK QUEUE</small><b>{summary.pendingApprovals + conflicts.length}<em> 项</em></b><span>{conflicts.length} 条版权冲突 / {summary.pendingApprovals} 个审批{summary.rejectedApprovals ? ` / ${summary.rejectedApprovals} 个待重提` : ''}</span></div></section>
    <nav className="tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>项目驾驶舱</button><button className={tab === 'budget' ? 'active' : ''} onClick={() => setTab('budget')}>预算与合同</button><button className={tab === 'rights' ? 'active' : ''} onClick={() => setTab('rights')}>资产版权图谱</button><span>交付日 {summary.project.deliveryDate}</span></nav>
    {tab === 'overview' && <div className="grid">
      <section className="panel hero"><div className="panel-head"><div><div className="eyebrow">PROJECT HEALTH / {summary.project.id}</div><h2>{summary.project.title}</h2></div><span className="badge amber">{summary.project.status.toUpperCase()}</span></div><div className="progress-label"><span>成本消耗 {Math.round(summary.utilization * 100)}%</span><b>{money(summary.actual)} / {money(summary.planned)}</b></div><div className="progress"><i style={{ width: `${Math.min(100, summary.utilization * 100)}%` }} /></div><div className="split"><div><small>合同暴露额</small><strong>{money(summary.contractExposure)}</strong></div><div><small>高风险预算项</small><strong className="bad">{summary.highRiskLines.length}</strong></div><div><small>版权冲突</small><strong className={conflicts.length ? 'bad' : ''}>{conflicts.length}</strong></div></div></section>
      <section className="panel approvals-panel">
        <div className="panel-head"><h3>审批闭环</h3><span>{summary.pendingApprovals} PENDING{summary.rejectedApprovals ? ` · ${summary.rejectedApprovals} 待重提` : ''}</span></div>
        {summary.approvals.length === 0 && <div className="empty">当前项目没有审批申请。</div>}
        {summary.approvals.map(a => <ApprovalCard key={a.id} approval={a} busy={busyId === a.id} anyBusy={busyId !== ''} onAction={runApprovalAction} />)}
      </section>
      <section className="panel wide"><div className="panel-head"><h3>交付风险雷达</h3><span>基于版本、授权窗口与预算预测</span></div>{conflicts.length ? conflicts.map((c, i) => <div className="risk-row" key={i}><strong className={c.severity}>{c.severity === 'critical' ? 'CRITICAL' : 'WARNING'}</strong><div><b>{c.assetA}</b><small>↔ {c.assetB} · {c.reason}</small></div></div>) : <div className="empty">当前项目未发现版权窗口冲突。</div>}</section>
      <section className="panel wide audit-panel"><div className="panel-head"><h3>审批审计事件</h3><span>提交 / 通过 / 驳回 / 重提全留痕</span></div>{audit.length ? audit.map(e => <div className="audit-row" key={e.id}><strong className={`audit-action ${e.action.toLowerCase()}`}>{e.action}</strong><div><b>{e.details}</b><small>{e.actor} · {e.entity} {e.entityId}{e.revision ? ` · 第 ${e.revision} 次提交` : ''}</small></div><em>{formatAt(e.at)}</em></div>) : <div className="empty">暂无审批审计事件。</div>}</section>
    </div>}
    {tab === 'budget' && <div className="grid"><section className="panel wide"><div className="panel-head"><h3>预算版本 V3 / 成本基线</h3><span>实际 + 承诺 + 预测</span></div><div className="table"><div className="tr th"><span>科目</span><span>预算</span><span>已承诺</span><span>实际</span><span>预测</span><span>风险</span></div>{summary.lines.map(line => <div className="tr" key={line.id}><span><b>{line.category}</b><small>{line.subcategory}</small></span><span>{money(line.planned)}</span><span>{money(line.committed)}</span><span>{money(line.actual)}</span><span className={line.forecast > line.planned ? 'bad' : ''}>{money(line.forecast)}</span><span className={`risk ${line.risk}`}>{line.risk}</span></div>)}</div></section><section className="panel"><div className="panel-head"><h3>供应商付款里程碑</h3></div>{summary.contracts.map(c => <div className="contract" key={c.vendor}><b>{c.vendor}</b><small>{c.scope}</small><div className="contract-bar"><i style={{ width: `${Math.round(c.paid / c.committed * 100)}%` }} /></div><span>{money(c.paid)} / {money(c.committed)}</span><em>{c.milestones.filter(m => m.status !== 'paid').length} 个待结点</em></div>)}</section></div>}
    {tab === 'rights' && <div className="grid"><section className="panel wide"><div className="panel-head"><h3>资产版本登记</h3><span>{summary.assets.length} assets / checksum tracked</span></div><div className="table"><div className="tr th"><span>资产</span><span>版本</span><span>状态</span><span>授权截止</span></div>{summary.assets.map(a => <div className="tr" key={a.id}><span><b>{a.name}</b><small>{a.id} · {a.type}</small></span><span>v{a.version}</span><span className={`pill ${a.status}`}>{a.status}</span><span>{a.availableTo}</span></div>)}</div></section><section className="panel"><div className="panel-head"><h3>授权冲突</h3><span>{conflicts.length} detected</span></div>{conflicts.map((c, i) => <div className="conflict" key={i}><strong>{c.severity}</strong><b>{c.assetA}</b><small>{c.reason}</small></div>)}</section></div>}
    <footer>FrameLedger baseline · 内存仓储 + REST API · 可扩展对象存储、预算版本审批、版权方台账与交付包校验</footer>
  </main>;
}

function ApprovalCard({ approval, busy, anyBusy, onAction }: { approval: Approval; busy: boolean; anyBusy: boolean; onAction: (a: Approval, path: string, init: RequestInit, ok: string, cardError: (msg: string) => void) => void }) {
  const [rejectDraft, setRejectDraft] = useState('');
  const [resubmitDraft, setResubmitDraft] = useState('');
  const [cardError, setCardError] = useState('');
  useEffect(() => { setRejectDraft(''); setResubmitDraft(''); setCardError(''); }, [approval.id, approval.revision, approval.status]);

  const done = approval.status === 'approved';
  const rejected = approval.status === 'rejected';
  const lastReject = [...approval.timeline].reverse().find(e => e.action === 'reject');
  const submit = (path: string, init: RequestInit, ok: string) => { setCardError(''); onAction(approval, path, init, ok, setCardError); };
  const doReject = () => {
    const reason = rejectDraft.trim();
    if (!reason) { setCardError('驳回必须填写可执行的整改意见，说明需要修改什么。'); return; }
    submit(`/approvals/${approval.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'rejected', comment: reason }) }, '已驳回，整改意见已留痕，制片团队可沿原申请重提');
  };
  const doResubmit = () => {
    const note = resubmitDraft.trim();
    if (!note) { setCardError('请填写本次修改说明（新上下文），历史驳回意见会一并保留。'); return; }
    submit(`/approvals/${approval.id}/resubmit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: note, actor: approval.requestedBy }) }, '已沿原申请重新提交，历史意见与本次修改均已保留');
  };

  return <div className={`approval approval-${approval.status}`}>
    <span className={`status ${approval.status}`} />
    <div className="approval-body">
      <b>{approval.title}{approval.revision > 1 && <i className="rev-badge">第 {approval.revision} 次提交</i>}</b>
      <small>{approval.requestedBy} 申请 · {approval.approver} 审批 · {approval.id}</small>
      <ol className="timeline">
        {approval.timeline.map((entry, i) => <li key={`${entry.at}-${i}`} className={`tl tl-${entry.action}`}><strong>{ACTION_LABEL[entry.action]}</strong><span>{entry.comment || '—'}</span><em>{entry.actor} · {formatAt(entry.at)}</em></li>)}
      </ol>
      {rejected && lastReject && <div className="reject-reason"><strong>驳回意见（需整改）</strong><p>{lastReject.comment}</p></div>}
      {done && <em className="done-text">已完成 · {approval.timeline.find(e => e.action === 'approve')?.comment || '审批通过'}</em>}
      {cardError && <div className="card-error" role="alert">{cardError}</div>}
      {rejected && <div className="action-form">
        <textarea value={resubmitDraft} disabled={anyBusy} placeholder="按驳回意见说明本次修改内容（新上下文），将沿同一申请重新进入审批队列" onChange={e => setResubmitDraft(e.target.value)} />
        <button className="primary" disabled={busy || anyBusy} onClick={doResubmit}>{busy ? '提交中…' : '修改后重新申请'}</button>
      </div>}
      {approval.status === 'pending' && <div className="action-form">
        <textarea value={rejectDraft} disabled={anyBusy} placeholder="驳回意见必填：写明财务要求的整改动作；留空直接点「通过」即可" onChange={e => setRejectDraft(e.target.value)} />
        <div className="action-row">
          <button className="approve-btn" disabled={busy || anyBusy} onClick={() => submit(`/approvals/${approval.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved', comment: '财务复核通过' }) }, '审批已通过，审计事件已写入')}>{busy ? '处理中…' : '通过'}</button>
          <button className="reject-btn" disabled={busy || anyBusy} onClick={doReject}>{busy ? '处理中…' : '驳回（需意见）'}</button>
        </div>
      </div>}
    </div>
    {done && <em className="done-side">已完成</em>}
  </div>;
}
