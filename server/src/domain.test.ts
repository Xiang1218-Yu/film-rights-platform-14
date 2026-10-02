import test from 'node:test'; import assert from 'node:assert/strict';
import { approve, approvalAudit, decideApproval, DomainError, normalizeApproval, projectSummary, resubmitApproval, rightsConflicts } from './domain.js';

test('budget summary exposes forecast variance and high risk lines', () => { const summary = projectSummary('PRJ-001'); assert.equal(summary.lines.length, 4); assert.ok(summary.forecast > summary.planned); assert.equal(summary.highRiskLines.length, 1); });
test('rights conflict engine detects overlapping licensed assets', () => { const conflicts = rightsConflicts('PRJ-001'); assert.ok(conflicts.length >= 1); assert.ok(conflicts.some(item => item.reason.includes('音乐-同步许可'))); });
test('approval changes are auditable and stateful', () => { const result = approve('APR-01', 'approved', '预算已复核'); assert.equal(result?.status, 'approved'); assert.equal(result?.comment, '预算已复核'); });

test('驳回必须填写可执行意见，空意见被拒绝且不改变状态', () => {
  const before = projectSummary('PRJ-001').approvals.find(a => a.id === 'APR-02');
  assert.equal(before?.status, 'pending');
  for (const empty of ['', '   ', undefined]) {
    assert.throws(() => decideApproval('APR-02', 'rejected', empty), (error: unknown) => error instanceof DomainError && error.status === 400 && error.code === 'empty_comment');
  }
  const after = projectSummary('PRJ-001').approvals.find(a => a.id === 'APR-02');
  assert.equal(after?.status, 'pending');
  assert.equal(after?.timeline.length, 1);
});

test('驳回写入意见、时间线与审计，且不再计入待办', () => {
  const result = decideApproval('APR-02', 'rejected', '母版 checksum 与交付清单不一致，请重新导出并补充 QC 报告');
  assert.equal(result.status, 'rejected');
  assert.equal(result.comment, '母版 checksum 与交付清单不一致，请重新导出并补充 QC 报告');
  assert.equal(result.timeline.at(-1)?.action, 'reject');
  const summary = projectSummary('PRJ-001');
  assert.equal(summary.approvals.find(a => a.id === 'APR-02')?.status, 'rejected');
  assert.equal(summary.pendingApprovals, summary.approvals.filter(a => a.status === 'pending').length);
  assert.equal(approvalAudit('PRJ-001').some(e => e.action === 'REJECT' && e.entityId === 'AST-001' && e.details.includes('checksum')), true);
});

test('重新提交沿原申请进行：历史意见保留、新上下文追加、版本号递增并回到待办', () => {
  const result = resubmitApproval('APR-02', '已重新导出母版并随附 QC 报告', undefined);
  assert.equal(result.id, 'APR-02');
  assert.equal(result.status, 'pending');
  assert.equal(result.revision, 2);
  assert.equal(result.comment, '');
  const actions = result.timeline.map(e => e.action);
  assert.deepEqual(actions, ['submit', 'reject', 'resubmit']);
  assert.ok(result.timeline.some(e => e.action === 'reject' && e.comment.includes('QC 报告')));
  assert.equal(result.timeline.at(-1)?.comment, '已重新导出母版并随附 QC 报告');
  const summary = projectSummary('PRJ-001');
  assert.equal(summary.approvals.find(a => a.id === 'APR-02')?.status, 'pending');
  assert.equal(summary.pendingApprovals, summary.approvals.filter(a => a.status === 'pending').length);
  const event = approvalAudit('PRJ-001').find(e => e.action === 'RESUBMIT');
  assert.equal(event?.revision, 2);
  assert.ok(event?.details.includes('QC 报告'));
});

test('他人先处理或双击终态返回 409，且不会产生重复审计事件', () => {
  const first = decideApproval('APR-02', 'approved', '复核通过');
  assert.equal(first.status, 'approved');
  const auditCount = approvalAudit('PRJ-001').filter(e => e.entityId === 'AST-001' && e.action === 'APPROVE').length;
  assert.throws(() => decideApproval('APR-02', 'approved', '再次通过'), (error: unknown) => error instanceof DomainError && error.status === 409 && error.code === 'conflict');
  assert.throws(() => decideApproval('APR-02', 'rejected', '迟到的驳回'), (error: unknown) => error instanceof DomainError && error.status === 409);
  assert.equal(approvalAudit('PRJ-001').filter(e => e.entityId === 'AST-001' && e.action === 'APPROVE').length, auditCount);
});

test('非法状态与非法流转被拒绝', () => {
  assert.throws(() => decideApproval('APR-02', 'maybe' as never, 'x'), (error: unknown) => error instanceof DomainError && error.status === 400 && error.code === 'invalid_status');
  assert.throws(() => resubmitApproval('APR-02', '再改一次', undefined), (error: unknown) => error instanceof DomainError && error.status === 409 && error.code === 'illegal_transition');
  assert.throws(() => decideApproval('APR-404', 'approved', ''), (error: unknown) => error instanceof DomainError && error.status === 404);
});

test('兼容旧版已通过数据：无 timeline 时从 comment 回填审批记录', () => {
  const legacy = normalizeApproval({ id: 'APR-OLD', projectId: 'PRJ-002', entityType: 'delivery', entityId: 'DEL-9', title: '旧交付', requestedBy: '发行部', status: 'approved', approver: '法务负责人', createdAt: '2026-09-01T00:00:00.000Z', comment: '已补充航拍授权凭证' });
  assert.equal(legacy.revision, 1);
  assert.equal(legacy.timeline.length, 1);
  assert.equal(legacy.timeline[0].action, 'approve');
  assert.equal(legacy.timeline[0].comment, '已补充航拍授权凭证');
  assert.equal(legacy.comment, '已补充航拍授权凭证');
  const legacyPending = normalizeApproval({ id: 'APR-OLD-2', status: 'pending', requestedBy: '制片', createdAt: '2026-09-02T00:00:00.000Z' });
  assert.equal(legacyPending.timeline[0].action, 'submit');
});
