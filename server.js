import express from 'express';
import helmet from 'helmet';
import crypto from 'node:crypto';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const MAX_DOCS = 2000;
const docs = new Map();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '256kb' }));

function adminOnly(req, res, next) {
  if (!ADMIN_API_KEY) return res.status(503).json({ ok: false, error: '管理员密钥未配置，请在环境变量中设置 ADMIN_API_KEY' });
  const supplied = req.get('x-admin-key') || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(ADMIN_API_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ ok: false, error: '未授权' });
  next();
}
function norm(s) { return String(s || '').toLocaleLowerCase().trim(); }
function scoreDoc(doc, terms) {
  const title = norm(doc.title), desc = norm(doc.description), text = norm(doc.text);
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (title.includes(term)) score += 8;
    if (desc.includes(term)) score += 4;
    if (text.includes(term)) score += 1;
  }
  return score;
}
function snippet(text, q) {
  const source = String(text || '');
  const at = norm(source).indexOf(norm(q));
  const start = at < 0 ? 0 : Math.max(0, at - 60);
  return source.slice(start, start + 220);
}

app.get('/', (_req, res) => res.json({
  name: 'shanjitong-search-backend', version: '1.0.0', status: 'running',
  endpoints: ['GET /health', 'GET /api/search?q=关键词', 'POST /api/pages', 'GET /api/stats', 'POST /api/instant']
}));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'shanjitong-search-backend', timestamp: new Date().toISOString() }));
app.get('/api/stats', adminOnly, (_req, res) => res.json({ ok: true, count: docs.size, storage: 'memory' }));

app.post('/api/pages', adminOnly, (req, res) => {
  const url = String(req.body?.url || '').trim();
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!url || !title || !text) return res.status(400).json({ ok: false, error: 'url、title、text 为必填字段' });
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ ok: false, error: 'url 格式无效' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ ok: false, error: '只允许 HTTP/HTTPS URL' });
  if (title.length > 300 || description.length > 3000 || text.length > 100000) return res.status(413).json({ ok: false, error: '字段内容过长' });
  const existing = [...docs.values()].find(d => d.url === url);
  const doc = { id: existing?.id || crypto.randomUUID(), url, title, description, text, updatedAt: new Date().toISOString() };
  if (!existing && docs.size >= MAX_DOCS) return res.status(507).json({ ok: false, error: `内存索引上限为 ${MAX_DOCS} 篇，请配置持久化数据库` });
  docs.set(doc.id, doc);
  res.status(existing ? 200 : 201).json({ ok: true, page: { id: doc.id, url: doc.url, title: doc.title, updatedAt: doc.updatedAt } });
});

app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ ok: false, error: '请提供查询参数 q，例如 /api/search?q=城市交通' });
  if (q.length > 200) return res.status(400).json({ ok: false, error: '查询词不能超过 200 个字符' });
  const terms = q.split(/\s+/).filter(Boolean);
  const results = [...docs.values()].map(d => ({ doc: d, score: scoreDoc(d, terms) }))
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.doc.updatedAt.localeCompare(a.doc.updatedAt))
    .slice(0, Math.min(Math.max(Number(req.query.limit) || 10, 1), 50))
    .map(({ doc, score }) => ({ id: doc.id, url: doc.url, title: doc.title, description: doc.description, score, snippet: snippet(doc.description || doc.text, q), updatedAt: doc.updatedAt }));
  res.json({ ok: true, query: q, count: results.length, results, note: '当前为内存索引，实例重启后索引会清空。' });
});

// Safe arithmetic-only evaluator: no eval, no variables, no function calls.
function calculate(expression) {
  const s = String(expression || '').replace(/\s+/g, '');
  if (!s || s.length > 100 || !/^[0-9.+\-*/()%^]+$/.test(s)) throw new Error('只支持数字、括号和 + - * / % ^ 运算');
  const tokens = s.match(/\d+(?:\.\d+)?|[()+\-*/%^]/g) || [];
  if (tokens.join('') !== s) throw new Error('表达式格式无效');
  let i = 0;
  function primary() {
    const t = tokens[i++];
    if (t === '+') return primary();
    if (t === '-') return -primary();
    if (t === '(') { const v = expr(0); if (tokens[i++] !== ')') throw new Error('括号不匹配'); return v; }
    const n = Number(t); if (!Number.isFinite(n)) throw new Error('数字无效'); return n;
  }
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
  function expr(min) {
    let left = primary();
    while (i < tokens.length) {
      const op = tokens[i], p = prec[op];
      if (p === undefined || p < min) break;
      i++; const right = expr(p + (op === '^' ? 0 : 1));
      if ((op === '/' || op === '%') && right === 0) throw new Error('不能除以零');
      if (op === '+') left += right; else if (op === '-') left -= right; else if (op === '*') left *= right; else if (op === '/') left /= right; else if (op === '%') left %= right; else left = left ** right;
      if (!Number.isFinite(left) || Math.abs(left) > 1e100) throw new Error('结果超出安全范围');
    }
    return left;
  }
  const result = expr(0); if (i !== tokens.length) throw new Error('表达式格式无效'); return result;
}
app.post('/api/instant', (req, res) => {
  try { const q = String(req.body?.q || ''); return res.json({ ok: true, query: q, result: calculate(q) }); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message || '计算失败' }); }
});

app.use((err, _req, res, _next) => {
  console.error('Request error:', err.message);
  res.status(err.status === 413 ? 413 : 400).json({ ok: false, error: '请求格式错误或请求体过大' });
});
app.listen(PORT, '0.0.0.0', () => console.log(`shanjitong-search-backend listening on 0.0.0.0:${PORT}`));
