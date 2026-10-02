export type ProjectStatus = 'development' | 'production' | 'post' | 'delivered';
export type AssetType = 'master' | 'trailer' | 'poster' | 'audio' | 'subtitle';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type TimelineAction = 'submit' | 'approve' | 'reject' | 'resubmit';

export interface Project { id: string; code: string; title: string; season: number; status: ProjectStatus; currency: string; budgetVersionId: string; deliveryDate: string; }
export interface BudgetLine { id: string; projectId: string; category: string; subcategory: string; planned: number; committed: number; actual: number; forecast: number; owner: string; risk: 'low' | 'medium' | 'high'; }
export interface Contract { id: string; projectId: string; vendor: string; scope: string; ceiling: number; committed: number; paid: number; milestones: { name: string; due: string; amount: number; status: 'open' | 'invoiced' | 'paid' }[]; }
export interface Asset { id: string; projectId: string; name: string; type: AssetType; version: number; status: 'draft' | 'review' | 'approved' | 'locked'; owner: string; checksum: string; territories: string[]; platforms: string[]; availableFrom: string; availableTo: string; rightsTags: string[]; }
export interface ApprovalTimelineEntry { action: TimelineAction; actor: string; comment: string; at: string; }
export interface Approval { id: string; projectId: string; entityType: 'budget' | 'asset' | 'delivery'; entityId: string; title: string; requestedBy: string; status: ApprovalStatus; approver: string; createdAt: string; comment?: string; revision: number; timeline: ApprovalTimelineEntry[]; }
export interface AuditEvent { id: string; action: string; entity: string; entityId: string; actor: string; at: string; details: string; projectId: string; revision?: number; }

/** 领域规则错误：HTTP 层据此区分 400（参数/空意见）与 409（状态冲突/他人先处理）。 */
export class DomainError extends Error {
  constructor(public status: number, message: string, public code: 'not_found' | 'invalid_status' | 'empty_comment' | 'illegal_transition' | 'conflict') { super(message); }
}

const now = Date.now();
const iso = (days: number) => new Date(now + days * 86400000).toISOString().slice(0, 10);
const stamp = (days: number) => new Date(now + days * 86400000).toISOString();
let auditSeq = 0;
const auditId = () => `AUD-${Date.now()}-${(auditSeq += 1)}`;

export const projects: Project[] = [
  { id: 'PRJ-001', code: 'NORTHSTAR-S1', title: 'Northstar / 北境回声', season: 1, status: 'post', currency: 'CNY', budgetVersionId: 'BUD-001-V3', deliveryDate: iso(44) },
  { id: 'PRJ-002', code: 'ORBIT-DOC', title: 'Orbit / 轨道之外', season: 1, status: 'production', currency: 'CNY', budgetVersionId: 'BUD-002-V2', deliveryDate: iso(126) }
];
export const budgetLines: BudgetLine[] = [
  { id: 'BL-101', projectId: 'PRJ-001', category: '制作', subcategory: '主演与主创', planned: 12800000, committed: 11200000, actual: 10400000, forecast: 13100000, owner: '制片部', risk: 'medium' },
  { id: 'BL-102', projectId: 'PRJ-001', category: '制作', subcategory: '摄影器材与场地', planned: 6800000, committed: 6400000, actual: 5980000, forecast: 7020000, owner: '现场制片', risk: 'low' },
  { id: 'BL-103', projectId: 'PRJ-001', category: '后期', subcategory: '调色、DIT、母版', planned: 5400000, committed: 4300000, actual: 2800000, forecast: 5750000, owner: '后期制片', risk: 'high' },
  { id: 'BL-104', projectId: 'PRJ-001', category: '宣发', subcategory: '预告片与物料', planned: 3600000, committed: 1900000, actual: 1240000, forecast: 3200000, owner: '营销部', risk: 'medium' },
  { id: 'BL-201', projectId: 'PRJ-002', category: '制作', subcategory: '跨国拍摄', planned: 9200000, committed: 5100000, actual: 3300000, forecast: 9000000, owner: '制片部', risk: 'medium' }
];
export const contracts: Contract[] = [
  { id: 'CTR-01', projectId: 'PRJ-001', vendor: '曜石后期制作', scope: '4K HDR 调色、声音、DCP 母版', ceiling: 5200000, committed: 4300000, paid: 2300000, milestones: [{ name: '锁剪交付', due: iso(8), amount: 1200000, status: 'invoiced' }, { name: '母版验收', due: iso(36), amount: 2000000, status: 'open' }] },
  { id: 'CTR-02', projectId: 'PRJ-001', vendor: '远景国际版权', scope: '北美与欧洲音乐同步许可', ceiling: 880000, committed: 880000, paid: 440000, milestones: [{ name: '签署', due: iso(-16), amount: 440000, status: 'paid' }, { name: '交付版权证明', due: iso(4), amount: 440000, status: 'invoiced' }] },
  { id: 'CTR-03', projectId: 'PRJ-002', vendor: '云帧视觉', scope: '纪录片航拍与卫星素材', ceiling: 1600000, committed: 1100000, paid: 600000, milestones: [{ name: '素材包一', due: iso(20), amount: 500000, status: 'open' }] }
];
export const assets: Asset[] = [
  { id: 'AST-001', projectId: 'PRJ-001', name: '北境回声 S01E01 4K HDR Master', type: 'master', version: 7, status: 'review', owner: '后期制片', checksum: 'sha256:91b7…e2a1', territories: ['CN', 'HK', 'SG'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-2), availableTo: iso(730), rightsTags: ['音乐-同步许可', '演员-全媒介'] },
  { id: 'AST-002', projectId: 'PRJ-001', name: '主预告 90s / Cut A', type: 'trailer', version: 4, status: 'approved', owner: '营销部', checksum: 'sha256:42ca…9b02', territories: ['CN'], platforms: ['StreamBox', '短视频'], availableFrom: iso(6), availableTo: iso(180), rightsTags: ['演员-宣传许可'] },
  { id: 'AST-003', projectId: 'PRJ-001', name: '片尾曲 / Winter Signal', type: 'audio', version: 2, status: 'locked', owner: '音乐版权', checksum: 'sha256:113c…78f0', territories: ['CN', 'US', 'CA'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-40), availableTo: iso(52), rightsTags: ['音乐-同步许可'] },
  { id: 'AST-004', projectId: 'PRJ-002', name: 'Orbit E02 Satellite Plates', type: 'master', version: 3, status: 'review', owner: '视觉总监', checksum: 'sha256:8a10…4a9d', territories: ['全球'], platforms: ['影院'], availableFrom: iso(18), availableTo: iso(365), rightsTags: ['航拍-编辑许可'] }
];

const seedApproval = (seed: { id: string; projectId: string; entityType: Approval['entityType']; entityId: string; title: string; requestedBy: string; status: ApprovalStatus; approver: string; createdAt: string; comment?: string }, timeline: ApprovalTimelineEntry[]): Approval =>
  ({ ...seed, revision: timeline.filter(entry => entry.action === 'submit' || entry.action === 'resubmit').length, timeline });

export const approvals: Approval[] = [
  seedApproval({ id: 'APR-01', projectId: 'PRJ-001', entityType: 'budget', entityId: 'BUD-001-V3', title: '后期超支预案 V3', requestedBy: '制片主任', status: 'pending', approver: '财务负责人', createdAt: iso(-1) }, [
    { action: 'submit', actor: '制片主任', comment: '后期科目预测超支 6.5%，申请调整预案', at: stamp(-1) }
  ]),
  seedApproval({ id: 'APR-02', projectId: 'PRJ-001', entityType: 'asset', entityId: 'AST-001', title: 'E01 最终母版锁定', requestedBy: '后期制片', status: 'pending', approver: '总制片人', createdAt: iso(-2) }, [
    { action: 'submit', actor: '后期制片', comment: 'v7 已完成调色与 QC，申请锁定母版', at: stamp(-2) }
  ]),
  seedApproval({ id: 'APR-03', projectId: 'PRJ-002', entityType: 'delivery', entityId: 'DEL-007', title: '海外节展交付包', requestedBy: '发行部', status: 'approved', approver: '法务负责人', createdAt: iso(-5), comment: '已补充航拍授权凭证' }, [
    { action: 'submit', actor: '发行部', comment: '节展预审需要交付包', at: stamp(-5) },
    { action: 'approve', actor: '法务负责人', comment: '已补充航拍授权凭证', at: stamp(-4) }
  ])
];
export const auditEvents: AuditEvent[] = [{ id: 'AUD-SEED-01', action: 'CREATE', entity: 'budget', entityId: 'BUD-001-V3', actor: '制片主任', at: stamp(-1), details: '从 V2 复制并调整后期科目', projectId: 'PRJ-001' }];

/** 兼容旧版内存/持久化数据：补齐 revision 与 timeline，历史 comment 原样保留为审批意见。 */
export function normalizeApproval(raw: Partial<Approval> & { id: string }): Approval {
  const timeline: ApprovalTimelineEntry[] = Array.isArray(raw.timeline) && raw.timeline.length
    ? raw.timeline
    : [{ action: raw.status === 'approved' ? 'approve' : 'submit', actor: raw.status === 'approved' ? (raw.approver ?? '财务负责人') : (raw.requestedBy ?? '申请人'), comment: raw.comment ?? '', at: raw.createdAt ?? new Date().toISOString() }];
  const submissions = timeline.filter(entry => entry.action === 'submit' || entry.action === 'resubmit').length;
  return {
    id: raw.id,
    projectId: raw.projectId ?? '',
    entityType: raw.entityType ?? 'budget',
    entityId: raw.entityId ?? '',
    title: raw.title ?? raw.id,
    requestedBy: raw.requestedBy ?? '',
    status: raw.status ?? 'pending',
    approver: raw.approver ?? '',
    createdAt: raw.createdAt ?? timeline[0]?.at ?? new Date().toISOString(),
    comment: raw.comment,
    revision: Number.isFinite(raw.revision) ? Number(raw.revision) : Math.max(1, submissions),
    timeline,
  };
}

export function projectSummary(projectId = projects[0].id) {
  const lines = budgetLines.filter(line => line.projectId === projectId);
  const projectContracts = contracts.filter(contract => contract.projectId === projectId);
  const projectAssets = assets.filter(asset => asset.projectId === projectId);
  const projectApprovals = approvals.filter(approval => approval.projectId === projectId).map(normalizeApproval);
  const planned = lines.reduce((sum, line) => sum + line.planned, 0);
  const forecast = lines.reduce((sum, line) => sum + line.forecast, 0);
  const actual = lines.reduce((sum, line) => sum + line.actual, 0);
  return { project: projects.find(project => project.id === projectId), planned, forecast, actual, variance: forecast - planned, utilization: planned ? actual / planned : 0, committed: lines.reduce((sum, line) => sum + line.committed, 0), contractExposure: projectContracts.reduce((sum, contract) => sum + contract.ceiling, 0), assetCount: projectAssets.length, pendingApprovals: projectApprovals.filter(item => item.status === 'pending').length, rejectedApprovals: projectApprovals.filter(item => item.status === 'rejected').length, highRiskLines: lines.filter(line => line.risk === 'high'), lines, contracts: projectContracts, assets: projectAssets, approvals: projectApprovals };
}

export function rightsConflicts(projectId = projects[0].id) {
  const list = assets.filter(asset => asset.projectId === projectId);
  const conflicts: { severity: 'critical' | 'warning'; assetA: string; assetB: string; reason: string }[] = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const a = list[i], b = list[j];
    const sameTag = a.rightsTags.some(tag => b.rightsTags.includes(tag));
    const sameTerritory = a.territories.includes('全球') || b.territories.includes('全球') || a.territories.some(territory => b.territories.includes(territory));
    if (sameTag && sameTerritory && a.availableTo >= b.availableFrom && b.availableTo >= a.availableFrom) conflicts.push({ severity: a.status === 'locked' || b.status === 'locked' ? 'critical' : 'warning', assetA: a.name, assetB: b.name, reason: `同一授权标签在重叠窗口内覆盖相同地域：${a.rightsTags.filter(tag => b.rightsTags.includes(tag)).join('、')}` });
  }
  return conflicts;
}

function recordAudit(entry: Omit<AuditEvent, 'id' | 'at'> & { at?: string }) {
  const event: AuditEvent = { id: auditId(), at: entry.at ?? new Date().toISOString(), ...entry };
  auditEvents.unshift(event);
  return event;
}

/** 财务审批：通过/驳回。驳回必须给出可执行意见；只有 pending 可处理，终态返回 409（他人先处理/双击）。 */
export function decideApproval(id: string, status: 'approved' | 'rejected', comment: string | undefined, actor = '当前审批人'): Approval {
  const item = approvals.find(approval => approval.id === id);
  if (!item) throw new DomainError(404, '审批不存在', 'not_found');
  if (status !== 'approved' && status !== 'rejected') throw new DomainError(400, `非法审批状态：${String(status)}`, 'invalid_status');
  const reason = (comment ?? '').trim();
  if (status === 'rejected' && !reason) throw new DomainError(400, '驳回必须填写可执行的整改意见', 'empty_comment');
  if (item.status !== 'pending') throw new DomainError(409, `该申请已被处理为「${item.status === 'approved' ? '已通过' : '已驳回'}」，请刷新查看最新状态`, 'conflict');
  item.status = status;
  item.comment = reason;
  const entry: ApprovalTimelineEntry = { action: status === 'approved' ? 'approve' : 'reject', actor, comment: item.comment, at: new Date().toISOString() };
  item.timeline.push(entry);
  recordAudit({ action: status === 'approved' ? 'APPROVE' : 'REJECT', entity: item.entityType, entityId: item.entityId, actor, projectId: item.projectId, revision: item.revision, details: item.comment || `${item.title} 已${status === 'approved' ? '通过' : '驳回'}` });
  return normalizeApproval(item);
}

/** 制片团队沿原申请重新提交：历史意见全部保留，新上下文追加到 timeline，同一 id 回到待办。 */
export function resubmitApproval(id: string, context: string | undefined, actor: string | undefined): Approval {
  const item = approvals.find(approval => approval.id === id);
  if (!item) throw new DomainError(404, '审批不存在', 'not_found');
  if (item.status !== 'rejected') throw new DomainError(409, '只有已驳回的申请可以重新提交', 'illegal_transition');
  const requester = (actor ?? item.requestedBy ?? '').trim() || item.requestedBy;
  const note = (context ?? '').trim() || '按驳回意见修改后重新提交';
  item.status = 'pending';
  item.comment = '';
  item.revision += 1;
  item.timeline.push({ action: 'resubmit', actor: requester, comment: note, at: new Date().toISOString() });
  recordAudit({ action: 'RESUBMIT', entity: item.entityType, entityId: item.entityId, actor: requester, projectId: item.projectId, revision: item.revision, details: `第 ${item.revision} 次提交：${note}` });
  return normalizeApproval(item);
}

/** 向后兼容旧调用方 approve(id, status, comment)；pending 视为沿原申请重新提交。 */
export function approve(id: string, status: ApprovalStatus = 'approved', comment = ''): Approval | undefined {
  if (status === 'pending') return resubmitApproval(id, comment, undefined);
  return decideApproval(id, status, comment);
}

export function createApproval(input: Pick<Approval, 'projectId' | 'entityType' | 'entityId' | 'title' | 'requestedBy' | 'approver'> & { comment?: string }) {
  const item = normalizeApproval({ ...input, id: `APR-${Date.now()}`, status: 'pending', createdAt: new Date().toISOString(), revision: 1, timeline: [{ action: 'submit', actor: input.requestedBy, comment: (input.comment ?? '').trim() || '新建审批申请', at: new Date().toISOString() }] });
  approvals.unshift(item);
  recordAudit({ action: 'SUBMIT', entity: item.entityType, entityId: item.entityId, actor: item.requestedBy, projectId: item.projectId, revision: 1, details: `${item.title} 提交审批` });
  return item;
}

export function approvalAudit(projectId?: string, limit = 50) {
  return auditEvents
    .filter(event => ['APPROVE', 'REJECT', 'RESUBMIT', 'SUBMIT'].includes(event.action) && (!projectId || event.projectId === projectId))
    .slice(0, limit);
}

export function dashboard() { return projects.map(project => projectSummary(project.id)).map(summary => ({ id: summary.project?.id, title: summary.project?.title, status: summary.project?.status, forecast: summary.forecast, variance: summary.variance, pendingApprovals: summary.pendingApprovals, rightsConflicts: rightsConflicts(summary.project?.id).length })); }
