// src/routes/diag.ts（仮）
import { Router } from 'express';
const r = Router();

r.get('/diag/jose', async (_req, res) => {
  try {
    // ここで jose を動的 import（CJS でも安全）
    await (eval('import("jose")') as Promise<any>);
    res.json({ ok: true, jose: 'loaded' });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default r;