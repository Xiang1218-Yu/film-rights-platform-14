import test from 'node:test'; import assert from 'node:assert/strict';
import { ApprovalFlowError, approvals, auditTrail, createApproval, decideApproval, normalizeApproval, projectSummary } from './domain.js';

const find = (id: string) => approvals.find(item => item.id === id)!;

test('驳回必须附意见：空意见 / 纯空白均被拒绝且状态不变', () => {
  const before = find('APR-01').status;
  for (const comment of ['', '   ']) {
    assert.throws(() => decideApproval({ id: 'APR-01', action: 'reject', comment }), (error: unknown) => error instanceof ApprovalFlowError && error.code === 'comment_required');
  }
  assert.equal(find('APR-01').status, before);
});

test('驳回写入可执行原因，制片团队可沿原申请重新提交且保留全部历史意见', () => {
  const rejected = decideApproval({ id: 'APR-01', action: 'reject', comment: '后期调色超支缺供应商二次报价，请补凭据', actor: '财务负责人' });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.decisions?.length, 1);

  const pendingAgain = decideApproval({ id: 'APR-01', action: 'resubmit', comment: '已补曜石二次报价与压价 8% 方案', actor: '制片主任' });
  assert.equal(pendingAgain.status, 'pending');
  assert.equal(pendingAgain.revision, 3);
  // 同一申请、同一 ID，历史驳回意见与新上下文都在时间线上
  assert.equal(pendingAgain.id, 'APR-01');
  assert.deepEqual(pendingAgain.decisions?.map(d => d.action), ['reject', 'resubmit']);
  assert.match(pendingAgain.decisions?.[0].comment ?? '', /二次报价/);
  assert.match(pendingAgain.decisions?.[1].comment ?? '', /压价/);

  const approved = decideApproval({ id: 'APR-01', action: 'approve', comment: '报价凭据齐全，通过', actor: '财务负责人' });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.revision, 4);
  assert.equal(approved.decisions?.length, 3);
});

test('重新申请必须说明修改内容；空说明不能回到待办', () => {
  decideApproval({ id: 'APR-02', action: 'reject', comment: '母版 checksum 与交付清单不符', actor: '总制片人' });
  assert.throws(() => decideApproval({ id: 'APR-02', action: 'resubmit', comment: '' }), (error: unknown) => error instanceof ApprovalFlowError && error.code === 'comment_required');
  assert.equal(find('APR-02').status, 'rejected');
});

test('已完成申请不可被普通操作改写：通过/驳回/重提全部拒绝', () => {
  const done = createApproval({ projectId: 'PRJ-001', entityType: 'budget', entityId: 'BUD-X', title: '一次性测试预算', requestedBy: '制片', approver: '财务' });
  decideApproval({ id: done.id, action: 'approve', actor: '财务' });
  for (const action of ['approve', 'reject', 'resubmit'] as const) {
    assert.throws(() => decideApproval({ id: done.id, action, comment: '再改改' }), (error: unknown) => error instanceof ApprovalFlowError && error.code === 'illegal_transition');
  }
  assert.equal(find(done.id).status, 'approved');
  assert.equal(find(done.id).decisions?.length, 1);
});

test('非法状态转移：被驳回不能重复驳回/直接视为通过以外的动作，待办不能重提', () => {
  // APR-02 已在上一例停留在 rejected
  assert.equal(find('APR-02').status, 'rejected');
  assert.throws(() => decideApproval({ id: 'APR-02', action: 'reject', comment: 'x' }), (error: unknown) => error instanceof ApprovalFlowError && error.code === 'illegal_transition');
  // 重提回到 pending 后，resubmit 不再合法；approve 走正常路径
  decideApproval({ id: 'APR-02', action: 'resubmit', comment: '已重新生成 checksum 并更新清单' });
  assert.equal(find('APR-02').status, 'pending');
  assert.throws(() => decideApproval({ id: 'APR-02', action: 'resubmit', comment: 'x' }), (error: unknown) => error instanceof ApprovalFlowError && error.code === 'illegal_transition');
});

test('他人先处理（版本不匹配）返回冲突，携带旧版本的操作不得落库', () => {
  const fresh = createApproval({ projectId: 'PRJ-001', entityType: 'asset', entityId: 'AST-X', title: '并发测试资产', requestedBy: '后期', approver: '财务' });
  // 另一人先驳回 → revision 增加
  decideApproval({ id: fresh.id, action: 'reject', comment: '材料不完整' });
  assert.throws(() => decideApproval({ id: fresh.id, action: 'approve', expectedRevision: 1 }), (error: unknown) => error instanceof ApprovalFlowError && error.code === 'conflict');
  assert.equal(find(fresh.id).status, 'rejected');
  // 以新版本操作可正常继续闭环
  assert.equal(decideApproval({ id: fresh.id, action: 'resubmit', comment: '补齐材料', expectedRevision: 2 }).status, 'pending');
});

test('未知动作与不存在申请分别报错', () => {
  assert.throws(() => decideApproval({ id: 'APR-01', action: 'nope' as never }), (error: unknown) => error instanceof ApprovalFlowError && error.code === 'invalid_action');
  assert.throws(() => decideApproval({ id: 'APR-404', action: 'approve' }), (error: unknown) => error instanceof ApprovalFlowError && error.code === 'not_found');
});

test('兼容已有已通过数据：旧记录补 revision/decisions，历史意见可展示', () => {
  const legacy = projectSummary('PRJ-002').approvals.find(a => a.id === 'APR-03')!;
  assert.equal(legacy.status, 'approved');
  assert.equal(legacy.revision, 1);
  assert.equal(legacy.decisions?.length, 1);
  assert.equal(legacy.decisions?.[0].action, 'approve');
  assert.equal(legacy.decisions?.[0].comment, '已补充航拍授权凭证');
  // normalize 幂等
  const again = normalizeApproval(legacy);
  assert.equal(again.decisions?.length, 1);
});

test('审计事件与闭环动作一致：驳回与重提均留痕且可按项目过滤', () => {
  const trail = auditTrail('PRJ-001');
  const actions = trail.map(event => event.action);
  assert.ok(actions.includes('REJECT'));
  assert.ok(actions.includes('RESUBMIT'));
  assert.ok(actions.includes('APPROVE'));
  const rejectEvent = trail.find(event => event.action === 'REJECT')!;
  assert.match(rejectEvent.details, /^驳回意见：/);
  assert.ok(!auditTrail('PRJ-002').some(event => event.entityId === 'BUD-001-V3' && event.action !== 'CREATE'));
});
