export type ProjectStatus = 'development' | 'production' | 'post' | 'delivered';
export type AssetType = 'master' | 'trailer' | 'poster' | 'audio' | 'subtitle';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
/** approve 财务通过；reject 财务驳回（必须附意见）；resubmit 制片团队沿原申请重提 */
export type ApprovalAction = 'approve' | 'reject' | 'resubmit';

export interface Project { id: string; code: string; title: string; season: number; status: ProjectStatus; currency: string; budgetVersionId: string; deliveryDate: string; }
export interface BudgetLine { id: string; projectId: string; category: string; subcategory: string; planned: number; committed: number; actual: number; forecast: number; owner: string; risk: 'low' | 'medium' | 'high'; }
export interface Contract { id: string; projectId: string; vendor: string; scope: string; ceiling: number; committed: number; paid: number; milestones: { name: string; due: string; amount: number; status: 'open' | 'invoiced' | 'paid' }[]; }
export interface Asset { id: string; projectId: string; name: string; type: AssetType; version: number; status: 'draft' | 'review' | 'approved' | 'locked'; owner: string; checksum: string; territories: string[]; platforms: string[]; availableFrom: string; availableTo: string; rightsTags: string[]; }

/** 一次审批决策；重提不新建申请，所有历史意见沿同一申请累积 */
export interface ApprovalDecision { action: ApprovalAction; actor: string; at: string; comment: string; revision: number; }
export interface Approval { id: string; projectId: string; entityType: 'budget' | 'asset' | 'delivery'; entityId: string; title: string; requestedBy: string; status: ApprovalStatus; approver: string; createdAt: string; comment?: string; revision?: number; decisions?: ApprovalDecision[]; updatedAt?: string; }
export interface AuditEvent { id: string; action: string; entity: string; entityId: string; actor: string; at: string; details: string; projectId?: string; }

export class ApprovalFlowError extends Error {
  constructor(public code: 'not_found' | 'invalid_action' | 'comment_required' | 'illegal_transition' | 'conflict', message: string) { super(message); this.name = 'ApprovalFlowError'; }
}

const now = Date.now();
const iso = (days: number) => new Date(now + days * 86400000).toISOString().slice(0, 10);

let sequence = 0;
const nextId = (prefix: string) => { sequence += 1; return `${prefix}-${Date.now()}-${sequence}`; };

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
/** 种子数据刻意保留旧形态（无 revision / decisions），由 normalizeApproval 兼容历史已通过数据 */
export const approvals: Approval[] = [
  { id: 'APR-01', projectId: 'PRJ-001', entityType: 'budget', entityId: 'BUD-001-V3', title: '后期超支预案 V3', requestedBy: '制片主任', status: 'pending', approver: '财务负责人', createdAt: iso(-1) },
  { id: 'APR-02', projectId: 'PRJ-001', entityType: 'asset', entityId: 'AST-001', title: 'E01 最终母版锁定', requestedBy: '后期制片', status: 'pending', approver: '总制片人', createdAt: iso(-2) },
  { id: 'APR-03', projectId: 'PRJ-002', entityType: 'delivery', entityId: 'DEL-007', title: '海外节展交付包', requestedBy: '发行部', status: 'approved', approver: '法务负责人', createdAt: iso(-5), comment: '已补充航拍授权凭证' }
];
export const auditEvents: AuditEvent[] = [{ id: 'AUD-01', action: 'CREATE', entity: 'budget', entityId: 'BUD-001-V3', actor: '制片主任', at: new Date(now - 86400000).toISOString(), details: '从 V2 复制并调整后期科目', projectId: 'PRJ-001' }];

/** 旧数据补默认值：已完成的历史决策折叠进时间线，驳回记录缺决策时以原意见回填，保证前端展示一致 */
export function normalizeApproval(item: Approval): Approval {
  if (item.revision === undefined) item.revision = 1;
  if (!item.decisions) {
    item.decisions = (item.status !== 'pending' && (item.comment || item.status === 'approved'))
      ? [{ action: item.status === 'approved' ? 'approve' : 'reject', actor: item.approver, at: item.updatedAt ?? item.createdAt, comment: item.comment ?? '', revision: 1 }]
      : [];
  }
  if (!item.updatedAt) item.updatedAt = item.decisions.length ? item.decisions[item.decisions.length - 1].at : item.createdAt;
  return item;
}
approvals.forEach(normalizeApproval);

export function projectSummary(projectId = projects[0].id) {
  const lines = budgetLines.filter(line => line.projectId === projectId);
  const projectContracts = contracts.filter(contract => contract.projectId === projectId);
  const projectAssets = assets.filter(asset => asset.projectId === projectId);
  const projectApprovals = approvals.filter(approval => approval.projectId === projectId).map(normalizeApproval);
  const planned = lines.reduce((sum, line) => sum + line.planned, 0);
  const forecast = lines.reduce((sum, line) => sum + line.forecast, 0);
  const actual = lines.reduce((sum, line) => sum + line.actual, 0);
  return { project: projects.find(project => project.id === projectId), planned, forecast, actual, variance: forecast - planned, utilization: planned ? actual / planned : 0, committed: lines.reduce((sum, line) => sum + line.committed, 0), contractExposure: projectContracts.reduce((sum, contract) => sum + contract.ceiling, 0), assetCount: projectAssets.length, pendingApprovals: projectApprovals.filter(item => item.status === 'pending').length, highRiskLines: lines.filter(line => line.risk === 'high'), lines, contracts: projectContracts, assets: projectAssets, approvals: projectApprovals };
}

export function rightsConflicts(projectId = projects[0].id) {
  const list = assets.filter(asset => asset.projectId === projectId);
  const conflicts: { severity: 'critical' | 'warning'; assetA: string; assetB: string; reason: string }[] = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const sameTag = a.rightsTags.some(tag => b.rightsTags.includes(tag));
    const sameTerritory = a.territories.includes('全球') || b.territories.includes('全球') || a.territories.some(territory => b.territories.includes(territory));
    if (sameTag && sameTerritory && a.availableTo >= b.availableFrom && b.availableTo >= a.availableFrom) conflicts.push({ severity: a.status === 'locked' || b.status === 'locked' ? 'critical' : 'warning', assetA: a.name, assetB: b.name, reason: `同一授权标签在重叠窗口内覆盖相同地域：${a.rightsTags.filter(tag => b.rightsTags.includes(tag)).join('、')}` });
  }
  return conflicts;
}

const ACTION_LABEL: Record<ApprovalAction, string> = { approve: 'APPROVE', reject: 'REJECT', resubmit: 'RESUBMIT' };

/**
 * 审批闭环状态机：
 * pending --approve--> approved（终态，不可再被普通操作改写）
 * pending --reject(必须有意见)--> rejected
 * rejected --resubmit(必须有修改说明)--> pending，revision+1，沿同一申请保留全部历史意见
 * expectedRevision 用于乐观并发：他人先处理导致版本/状态变化时返回 409。
 */
export function decideApproval(input: { id: string; action: ApprovalAction; comment?: string; actor?: string; expectedRevision?: number }): Approval {
  const item = approvals.find(approval => approval.id === input.id);
  if (!item) throw new ApprovalFlowError('not_found', '审批不存在');
  normalizeApproval(item);
  const action = input.action;
  if (!action || !['approve', 'reject', 'resubmit'].includes(action)) throw new ApprovalFlowError('invalid_action', `不支持的审批动作：${String(action)}`);

  const comment = (input.comment ?? '').trim();
  if (action === 'reject' && !comment) throw new ApprovalFlowError('comment_required', '驳回必须填写可执行的原因');
  if (action === 'resubmit' && !comment) throw new ApprovalFlowError('comment_required', '重新申请必须说明修改内容与新增上下文');

  // 请求体自身合法后先做乐观并发校验：版本落后说明他人已先处理，前端必须以最新状态为准
  if (input.expectedRevision !== undefined && input.expectedRevision !== item.revision) throw new ApprovalFlowError('conflict', '该申请已被他人先处理，列表已刷新，请确认后重试');

  if (action === 'approve' && item.status !== 'pending') throw new ApprovalFlowError('illegal_transition', `当前状态为 ${item.status}，仅待处理申请可通过`);
  if (action === 'reject' && item.status !== 'pending') throw new ApprovalFlowError('illegal_transition', `当前状态为 ${item.status}，仅待处理申请可驳回`);
  if (action === 'resubmit' && item.status !== 'rejected') throw new ApprovalFlowError('illegal_transition', `当前状态为 ${item.status}，仅被驳回的申请可沿原意见重新提交`);

  const at = new Date().toISOString();
  const actor = input.actor || (action === 'resubmit' ? item.requestedBy : item.approver);
  // 每次落库决策都推进版本：他人先通过/先驳回同样会让旧版本请求冲突
  item.revision = (item.revision ?? 1) + 1;
  if (action === 'resubmit') item.status = 'pending';
  else item.status = action === 'approve' ? 'approved' : 'rejected';
  if (comment) item.comment = comment;
  item.updatedAt = at;
  item.decisions!.push({ action, actor, at, comment, revision: item.revision });

  const details = action === 'reject' ? `驳回意见：${comment}`
    : action === 'resubmit' ? `沿原申请重新提交（第 ${item.revision} 版）：${comment}`
      : comment || `${item.title} 已通过`;
  auditEvents.unshift({ id: nextId('AUD'), action: ACTION_LABEL[action], entity: item.entityType, entityId: item.entityId, actor, at, details, projectId: item.projectId });
  return item;
}

/** 兼容旧调用方：直接给状态（驳回时仍要求意见，校验在 decideApproval 内完成） */
export function approve(id: string, status: ApprovalStatus, comment = '', actor?: string) {
  try { return decideApproval({ id, action: status === 'approved' ? 'approve' : 'reject', comment, actor }); }
  catch (error) { if (error instanceof ApprovalFlowError && error.code === 'not_found') return undefined; throw error; }
}

export function createApproval(input: Pick<Approval, 'projectId' | 'entityType' | 'entityId' | 'title' | 'requestedBy' | 'approver'>) {
  const item: Approval = { ...input, id: nextId('APR'), status: 'pending', revision: 1, decisions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  approvals.unshift(normalizeApproval(item));
  return item;
}

/** 审计时间线：优先按 projectId，兼容未带 projectId 的旧审计事件（按实体归属回溯） */
export function auditTrail(projectId?: string) {
  if (!projectId) return auditEvents;
  const entityProjects = new Map<string, string>();
  [...budgetLines, ...contracts, ...assets, ...approvals].forEach(entity => { if ('projectId' in entity) entityProjects.set(entity.id, entity.projectId); });
  return auditEvents.filter(event => event.projectId === projectId || (!event.projectId && entityProjects.get(event.entityId) === projectId));
}

export function dashboard() { return projects.map(project => projectSummary(project.id)).map(summary => ({ id: summary.project?.id, title: summary.project?.title, status: summary.project?.status, forecast: summary.forecast, variance: summary.variance, pendingApprovals: summary.pendingApprovals, rightsConflicts: rightsConflicts(summary.project?.id).length })); }
