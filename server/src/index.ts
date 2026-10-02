import express from 'express';
import { ApprovalFlowError, assets, auditTrail, budgetLines, contracts, createApproval, dashboard, decideApproval, projectSummary, projects, rightsConflicts } from './domain.js';
const app = express(); app.use(express.json());
app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => { const result = projectSummary(req.params.id); if (!result.project) return res.status(404).json({ message: '项目不存在' }); res.json(result); });
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));
app.get('/api/budgets/:projectId/lines', (req, res) => res.json(budgetLines.filter(line => line.projectId === req.params.projectId)));
app.get('/api/audit-events', (req, res) => res.json(auditTrail(typeof req.query.projectId === 'string' ? req.query.projectId : undefined)));
app.post('/api/approvals', (req, res) => res.status(201).json(createApproval(req.body)));
// 新契约：{ action: approve|reject|resubmit, comment, expectedRevision, actor }
// 兼容旧契约：{ status: approved|rejected, comment }
app.patch('/api/approvals/:id', (req, res) => {
  const action = req.body.action ?? (req.body.status ? (req.body.status === 'approved' ? 'approve' : 'reject') : undefined);
  try {
    const result = decideApproval({ id: req.params.id, action, comment: req.body.comment ?? '', actor: req.body.actor, expectedRevision: req.body.expectedRevision });
    res.json(result);
  } catch (error) {
    if (error instanceof ApprovalFlowError) {
      const http = { not_found: 404, invalid_action: 400, comment_required: 400, illegal_transition: 409, conflict: 409 }[error.code];
      return res.status(http).json({ message: error.message, code: error.code });
    }
    return res.status(500).json({ message: '审批服务异常' });
  }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));
const port = Number(process.env.PORT || 4104); app.listen(port, () => console.log(`film rights API listening on ${port}`));
