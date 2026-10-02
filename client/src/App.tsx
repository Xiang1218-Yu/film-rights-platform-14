import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Project = { id: string; title: string; status: string; deliveryDate: string };
type ApprovalAction = 'approve' | 'reject' | 'resubmit';
type Decision = { action: ApprovalAction; actor: string; at: string; comment: string; revision: number };
type Approval = {
  id: string; projectId: string; title: string; status: 'pending' | 'approved' | 'rejected';
  approver: string; requestedBy: string; entityType: string; createdAt: string;
  revision: number; comment?: string; decisions: Decision[];
};
type Summary = {
  planned: number; forecast: number; actual: number; variance: number; utilization: number;
  committed: number; contractExposure: number; assetCount: number; pendingApprovals: number;
  highRiskLines: { subcategory: string; forecast: number; planned: number }[];
  lines: { id: string; category: string; subcategory: string; planned: number; forecast: number; actual: number; risk: string }[];
  contracts: { vendor: string; scope: string; committed: number; paid: number; milestones: { name: string; due: string; status: string }[] }[];
  assets: { id: string; name: string; type: string; version: number; status: string; availableTo: string }[];
  approvals: Approval[]; project: Project;
};
type Conflict = { severity: string; assetA: string; assetB: string; reason: string };
type AuditEvent = { id: string; action: string; entity: string; entityId: string; actor: string; at: string; details: string };
type Notice = { kind: 'info' | 'error'; text: string; retry?: () => void };

const money = (n: number) => `¥${(n / 10000).toFixed(0)}万`;
const api = '/api';
const atTime = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? at : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const ACTION_TEXT: Record<ApprovalAction, string> = { approve: '通过', reject: '驳回', resubmit: '重新申请' };
const DECISION_TEXT: Record<ApprovalAction, string> = { approve: '通过', reject: '驳回', resubmit: '沿原申请重新提交' };
const AUDIT_TEXT: Record<string, string> = { APPROVE: '通过', REJECT: '驳回', RESUBMIT: '重新提交', CREATE: '创建' };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `请求失败 (${response.status})`) as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body as T;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('PRJ-001');
  const [summary, setSummary] = useState<Summary>();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [tab, setTab] = useState<'overview' | 'budget' | 'rights'>('overview');
  const [notice, setNotice] = useState<Notice>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // 正在执行决策的审批 id+动作：按钮在服务端确认前一直保持忙碌，绝不提前显示成功
  const [busy, setBusy] = useState<{ id: string; action: ApprovalAction }>();
  // 驳回意见 / 重提说明的行内草稿
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<ApprovalAction, string>>>>({});
  const [openForm, setOpenForm] = useState<{ id: string; action: ApprovalAction }>();
  const busyRef = useRef<string | undefined>(undefined);

  const load = useCallback(async (id = 'PRJ-001', silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setNotice(undefined);
    try {
      const items = await request<Project[]>('/projects');
      const active = items.find(item => item.id === id) ?? items[0];
      if (!active) throw new Error('服务端没有返回项目数据');
      const [s, c, events] = await Promise.all([
        request<Summary>(`/projects/${active.id}/summary`),
        request<Conflict[]>(`/projects/${active.id}/rights-conflicts`),
        request<AuditEvent[]>(`/audit-events?projectId=${encodeURIComponent(active.id)}`),
      ]);
      setProjects(items);
      setSelected(active.id);
      setSummary(s);
      setConflicts(c);
      setAudit(events);
    } catch (reason) {
      setNotice({ kind: 'error', text: reason instanceof Error ? reason.message : '无法连接制作服务' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 决策提交：双击由 busyRef + busy 双重拦截；失败只提示（可重试），不改动任何本地状态
  const decide = useCallback(async (item: Approval, action: ApprovalAction, comment: string) => {
    const key = `${item.id}:${action}`;
    if (busyRef.current) return;
    busyRef.current = key;
    setBusy({ id: item.id, action });
    setNotice(undefined);
    const payload = { action, comment, expectedRevision: item.revision };
    // 成功闭环（提示 + 全量刷新）也包进 run，使网络失败后的“重试”是同一笔可重复操作
    const run = async () => {
      await request(`/approvals/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setOpenForm(undefined);
      setDrafts(prev => ({ ...prev, [item.id]: { reject: '', resubmit: '' } }));
      // 待办计数 / 风险 / 审计 / 队列用同一份最新服务端数据刷新，保证各视图一致；先刷新后提示
      await load(item.projectId, true);
      setNotice({ kind: 'info', text: action === 'reject' ? '已驳回，驳回意见已写入审批与审计' : action === 'resubmit' ? '已沿原申请重新提交，历史意见完整保留' : '审批已通过，审计事件已写入' });
    };
    try {
      await run();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '审批操作失败';
      const status = (reason as { status?: number })?.status;
      if (status === 409) {
        // 他人先处理或非法状态：立即静默刷新到最新，禁止沿旧上下文继续操作
        await load(item.projectId, true);
        setOpenForm(undefined);
        setNotice({ kind: 'error', text: `操作未生效：${message}` });
      } else {
        // 网络/5xx：本地状态未动，按钮恢复，可原样重试
        setNotice({ kind: 'error', text: `操作未生效：${message}`, retry: () => void run() });
      }
    } finally {
      busyRef.current = undefined;
      setBusy(undefined);
    }
  }, [load]);

  const variancePct = useMemo(() => summary ? Math.round(summary.variance / summary.planned * 100) : 0, [summary]);

  if (loading && !summary) return <main className="connection-state"><div className="loading">正在载入制作控制台…</div><small>正在通过 Vite API 代理连接本地制作服务</small></main>;
  if (!summary) return <main className="connection-state"><h2>无法连接制作服务</h2><p>{notice?.text || '服务端没有返回项目数据。'}</p><p>请从项目根目录运行 <code>npm run dev</code>，确认前端 5173 和 API 4104 均已启动。</p><button onClick={() => void load(selected)}>重新连接</button></main>;

  const sortedApprovals = [...summary.approvals].sort((a, b) => {
    const rank = { pending: 0, rejected: 1, approved: 2 }[a.status] - { pending: 0, rejected: 1, approved: 2 }[b.status];
    return rank || (a.createdAt < b.createdAt ? -1 : 1);
  });

  return <main>
    <header>
      <div>
        <div className="eyebrow">STUDIO OPS / RIGHTS & FINANCE CONTROL</div>
        <h1>FrameLedger <span>影视制作预算与资产版权协同</span></h1>
        <p>将预算承诺、供应商付款、资产版本与跨地域版权窗口串成可审计的交付链路。</p>
      </div>
      <div className="header-actions">
        <select value={selected} disabled={refreshing} onChange={e => { setSelected(e.target.value); void load(e.target.value); }}>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
        <span className="live"><i /> LIVE CONTROL</span>
      </div>
    </header>

    {notice && <div className={`toast ${notice.kind === 'error' ? 'error-toast' : ''}`} onClick={() => setNotice(undefined)}>
      {notice.text}
      {notice.retry && <button className="toast-action" onClick={e => { e.stopPropagation(); const retry = notice.retry!; setNotice(undefined); retry(); }}>重试</button>}
      <span> ×</span>
    </div>}

    <section className="kpis">
      <div><small>FORECAST COST</small><b>{money(summary.forecast)}</b><span>预算偏差 <em className={summary.variance > 0 ? 'bad' : ''}>{variancePct}%</em></span></div>
      <div><small>COMMITTED</small><b>{money(summary.committed)}</b><span>已锁定供应商与合同</span></div>
      <div><small>ASSET REGISTER</small><b>{summary.assetCount}<em> 个</em></b><span>版本与交付状态纳管</span></div>
      <div><small>RISK QUEUE</small><b>{summary.pendingApprovals + conflicts.length}<em> 项</em></b><span>{conflicts.length} 条版权冲突 / {summary.pendingApprovals} 个审批</span></div>
    </section>

    <nav className="tabs">
      <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>项目驾驶舱</button>
      <button className={tab === 'budget' ? 'active' : ''} onClick={() => setTab('budget')}>预算与合同</button>
      <button className={tab === 'rights' ? 'active' : ''} onClick={() => setTab('rights')}>资产版权图谱</button>
      <span>交付日 {summary.project.deliveryDate}</span>
    </nav>

    {tab === 'overview' && <div className="grid">
      <section className="panel hero">
        <div className="panel-head"><div><div className="eyebrow">PROJECT HEALTH / {summary.project.id}</div><h2>{summary.project.title}</h2></div><span className="badge amber">{summary.project.status.toUpperCase()}</span></div>
        <div className="progress-label"><span>成本消耗 {Math.round(summary.utilization * 100)}%</span><b>{money(summary.actual)} / {money(summary.planned)}</b></div>
        <div className="progress"><i style={{ width: `${Math.min(100, summary.utilization * 100)}%` }} /></div>
        <div className="split"><div><small>合同暴露额</small><strong>{money(summary.contractExposure)}</strong></div><div><small>高风险预算项</small><strong className="bad">{summary.highRiskLines.length}</strong></div><div><small>版权冲突</small><strong className={conflicts.length ? 'bad' : ''}>{conflicts.length}</strong></div></div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>待审批队列</h3>
          <span>{summary.pendingApprovals} PENDING
            <button className="refresh-btn" disabled={refreshing || !!busy} onClick={() => void load(selected, true)} title="重新从服务端拉取最新状态">{refreshing ? '同步中…' : '刷新'}</button>
          </span>
        </div>
        {sortedApprovals.map(a => <ApprovalCard
          key={a.id}
          item={a}
          disabled={refreshing || !!busy}
          busy={busy?.id === a.id ? busy.action : undefined}
          open={openForm?.id === a.id ? openForm.action : undefined}
          draft={drafts[a.id] ?? {}}
          onOpen={action => setOpenForm({ id: a.id, action })}
          onCancel={() => setOpenForm(undefined)}
          onDraft={(action, value) => setDrafts(prev => ({ ...prev, [a.id]: { ...prev[a.id], [action]: value } }))}
          onSubmit={(action, comment) => void decide(a, action, comment)}
        />)}
      </section>

      <section className="panel wide">
        <div className="panel-head"><h3>交付风险雷达</h3><span>基于版本、授权窗口与预算预测</span></div>
        {conflicts.length ? conflicts.map((c, i) => <div className="risk-row" key={i}><strong className={c.severity}>{c.severity === 'critical' ? 'CRITICAL' : 'WARNING'}</strong><div><b>{c.assetA}</b><small>↔ {c.assetB} · {c.reason}</small></div></div>) : <div className="empty">当前项目未发现版权窗口冲突。</div>}
      </section>

      <section className="panel wide">
        <div className="panel-head"><h3>审批审计轨迹</h3><span>通过 / 驳回 / 沿原申请重提 均实时留痕</span></div>
        {audit.length ? audit.map(event => <div className="audit-row" key={event.id}>
          <strong className={`audit-tag ${event.action.toLowerCase()}`}>{AUDIT_TEXT[event.action] ?? event.action}</strong>
          <div><b>{event.details}</b><small>{event.actor} · {event.entity} / {event.entityId} · {atTime(event.at)}</small></div>
        </div>) : <div className="empty">暂无审批事件。</div>}
      </section>
    </div>}

    {tab === 'budget' && <div className="grid">
      <section className="panel wide">
        <div className="panel-head"><h3>预算版本 V3 / 成本基线</h3><span>实际 + 承诺 + 预测</span></div>
        <div className="table"><div className="tr th"><span>科目</span><span>预算</span><span>已承诺</span><span>实际</span><span>预测</span><span>风险</span></div>{summary.lines.map(line => <div className="tr" key={line.id}><span><b>{line.category}</b><small>{line.subcategory}</small></span><span>{money(line.planned)}</span><span>{money(line.planned ? line.planned : 0)}</span><span>{money(line.actual)}</span><span className={line.forecast > line.planned ? 'bad' : ''}>{money(line.forecast)}</span><span className={`risk ${line.risk}`}>{line.risk}</span></div>)}</div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>供应商付款里程碑</h3></div>
        {summary.contracts.map(c => <div className="contract" key={c.vendor}><b>{c.vendor}</b><small>{c.scope}</small><div className="contract-bar"><i style={{ width: `${Math.round(c.paid / c.committed * 100)}%` }} /></div><span>{money(c.paid)} / {money(c.committed)}</span><em>{c.milestones.filter(m => m.status !== 'paid').length} 个待结点</em></div>)}
      </section>
    </div>}

    {tab === 'rights' && <div className="grid">
      <section className="panel wide">
        <div className="panel-head"><h3>资产版本登记</h3><span>{summary.assets.length} assets / checksum tracked</span></div>
        <div className="table"><div className="tr th"><span>资产</span><span>版本</span><span>状态</span><span>授权截止</span></div>{summary.assets.map(a => <div className="tr" key={a.id}><span><b>{a.name}</b><small>{a.id} · {a.type}</small></span><span>v{a.version}</span><span className={`pill ${a.status}`}>{a.status}</span><span>{a.availableTo}</span></div>)}</div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>授权冲突</h3><span>{conflicts.length} detected</span></div>
        {conflicts.map((c, i) => <div className="conflict" key={i}><strong>{c.severity}</strong><b>{c.assetA}</b><small>{c.reason}</small></div>)}
      </section>
    </div>}

    <footer>FrameLedger baseline · 内存仓储 + REST API · 可扩展对象存储、预算版本审批、版权方台账与交付包校验</footer>
  </main>;
}

function DecisionTimeline({ decisions }: { decisions: Decision[] }) {
  if (!decisions.length) return null;
  return <div className="decisions">
    {decisions.map((d, i) => <div className={`decision ${d.action}`} key={`${d.at}-${i}`}>
      <i className={`decision-dot ${d.action}`} />
      <div><b>{DECISION_TEXT[d.action]}<em>v{d.revision}</em></b><small>{d.actor} · {atTime(d.at)}{d.comment ? ` · ${d.comment}` : ''}</small></div>
    </div>)}
  </div>;
}

function ApprovalCard(props: {
  item: Approval;
  disabled: boolean;
  busy?: ApprovalAction;
  open?: ApprovalAction;
  draft: Partial<Record<ApprovalAction, string>>;
  onOpen: (action: ApprovalAction) => void;
  onCancel: () => void;
  onDraft: (action: ApprovalAction, value: string) => void;
  onSubmit: (action: ApprovalAction, comment: string) => void;
}) {
  const { item, disabled, busy, open, draft, onOpen, onCancel, onDraft, onSubmit } = props;
  const formAction = open;
  const draftText = (formAction && draft[formAction]) ?? '';
  const resubmitCount = item.decisions.filter(d => d.action === 'resubmit').length;
  const statusLabel = item.status === 'pending' ? (resubmitCount ? `待处理 · 第 ${resubmitCount + 1} 版` : '待处理') : item.status === 'rejected' ? '已驳回 · 待修改重提' : '已完成';

  return <div className={`approval ${item.status}`}>
    <span className={`status ${item.status}`} />
    <div className="approval-main">
      <b>{item.title}{item.revision > 1 && <em className="rev-pill">v{item.revision}</em>}</b>
      <small>{item.requestedBy} 提 · {item.approver} 审 · {item.id} · {item.entityType} · <span className={`state-text ${item.status}`}>{statusLabel}</span></small>
      <DecisionTimeline decisions={item.decisions} />
      {formAction && <div className="decision-form">
        <textarea
          autoFocus
          value={draftText}
          disabled={disabled}
          placeholder={formAction === 'reject' ? '驳回必须写明可执行原因：缺哪些凭据、改哪里、由谁跟进（提交即留据）' : '说明本次修改内容与新增上下文：历史意见将沿原申请完整保留'}
          onChange={e => onDraft(formAction, e.target.value)}
          rows={2}
        />
        <div className="decision-actions">
          <button disabled={disabled || !draftText.trim()} onClick={() => onSubmit(formAction, draftText.trim())}>
            {busy ? `${ACTION_TEXT[formAction]}提交中…` : `确认${ACTION_TEXT[formAction]}`}
          </button>
          <button className="ghost" disabled={disabled} onClick={onCancel}>取消</button>
          {!draftText.trim() && <small className="hint">{formAction === 'reject' ? '驳回意见为必填项' : '修改说明为必填项'}</small>}
        </div>
      </div>}
    </div>
    {/* 已完成（通过）申请不渲染任何可写操作，普通点击/双击都无法改写 */}
    {item.status === 'approved' && <em className="done">已完成</em>}
    {item.status === 'rejected' && (formAction === 'resubmit'
      ? <em className="reopened">修改中</em>
      : <button className="resubmit" disabled={disabled || busy === 'reject'} onClick={() => onOpen('resubmit')}>{busy === 'resubmit' ? '提交中…' : '重新申请'}</button>)}
    {item.status === 'pending' && !formAction && <div className="approval-buttons">
      <button className="approve" disabled={disabled} onClick={() => onSubmit('approve', '')}>{busy === 'approve' ? '处理中…' : '通过'}</button>
      <button className="reject" disabled={disabled || busy === 'approve'} onClick={() => onOpen('reject')}>驳回</button>
    </div>}
    {item.status === 'pending' && formAction === 'reject' && <em className="reopened">填写意见中</em>}
  </div>;
}
