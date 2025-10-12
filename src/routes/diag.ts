import { Router } from 'express';

const r = Router();

// jose の読み込み確認
r.get('/diag/jose', async (_req, res) => {
  try {
    // TS が require に変換しないよう eval を使う
    await (eval('import("jose")') as Promise<any>);
    res.json({ ok: true, jose: 'loaded' });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

export default r;