import express from 'express';
import { approvalAudit, assets, budgetLines, contracts, createApproval, dashboard, decideApproval, DomainError, projectSummary, projects, resubmitApproval, rightsConflicts } from './domain.js';

const app = express();
app.use(express.json());

function domainError(error: unknown, res: express.Response) {
  if (error instanceof DomainError) return res.status(error.status).json({ message: error.message, code: error.code });
  throw error;
}

app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => { const result = projectSummary(req.params.id); if (!result.project) return res.status(404).json({ message: '项目不存在' }); res.json(result); });
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));
app.get('/api/budgets/:projectId/lines', (req, res) => res.json(budgetLines.filter(line => line.projectId === req.params.projectId)));
app.get('/api/approvals/audit', (req, res) => res.json(approvalAudit(typeof req.query.projectId === 'string' ? req.query.projectId : undefined)));
app.post('/api/approvals', (req, res) => res.status(201).json(createApproval(req.body)));
// 财务决策：通过/驳回。驳回空意见 -> 400；他人已先处理/双击终态 -> 409。
app.patch('/api/approvals/:id', (req, res) => {
  try {
    if (req.body?.action === 'resubmit') return res.json(resubmitApproval(req.params.id, req.body?.context ?? req.body?.comment, req.body?.actor));
    return res.json(decideApproval(req.params.id, req.body?.status, req.body?.comment, req.body?.actor ?? '当前审批人'));
  } catch (error) { return domainError(error, res); }
});
// 制片团队沿原申请重新提交：历史意见保留，新上下文追加到同一申请。
app.post('/api/approvals/:id/resubmit', (req, res) => {
  try { return res.json(resubmitApproval(req.params.id, req.body?.context ?? req.body?.comment, req.body?.actor)); }
  catch (error) { return domainError(error, res); }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));

const port = Number(process.env.PORT || 4104);
app.listen(port, () => console.log(`film rights API listening on ${port}`));
