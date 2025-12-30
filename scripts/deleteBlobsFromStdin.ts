// scripts/deleteBlobsFromStdin.ts
import { del } from '@vercel/blob';

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function normalizeLinesToUrls(input: string): string[] {
  // psql の出力をそのまま食べても良いように、雑に「それっぽいURL」だけ拾う
  const lines = input
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const urls: string[] = [];
  for (const line of lines) {
    // psql の罫線やヘッダっぽいのを除外
    if (line.startsWith('url')) continue;
    if (/^-+$/.test(line)) continue;
    if (/^\(\d+\s+rows?\)$/.test(line)) continue;

    // 行の中にURLが含まれるケースも拾う
    const m = line.match(/https?:\/\/\S+/g);
    if (m) urls.push(...m.map((x) => x.replace(/[),.]+$/g, '')));
  }

  // 重複排除
  return Array.from(new Set(urls));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function delCompat(urls: string[]) {
  // @vercel/blob の del は「string | string[]」で動く想定。
  // もし型/バージョン差で落ちる場合に備えてフォールバックも用意。
  try {
    // まとめて削除
    await del(urls as any);
    return;
  } catch (e1) {
    // 1件ずつ
    for (const u of urls) {
      await del(u as any);
    }
  }
}

async function main() {
  const raw = await readAllStdin();
  const urls = normalizeLinesToUrls(raw);

  if (urls.length === 0) {
    console.log('[blob-delete] no urls found on stdin');
    process.exit(0);
  }

  // ざっくり安全策：明らかに違うURLは弾く（必要なら条件を緩めてOK）
  const candidates = urls.filter((u) => /^https?:\/\/.+/i.test(u));

  console.log(`[blob-delete] urls=${candidates.length}`);

  const BATCH = Number(process.env.BLOB_DELETE_BATCH || 20); // まとめて消す単位
  const CONC  = Number(process.env.BLOB_DELETE_CONCURRENCY || 3); // 並列バッチ数

  const batches = chunk(candidates, BATCH);
  const failed: { url: string; error: string }[] = [];

  let idx = 0;
  async function worker(workerId: number) {
    while (idx < batches.length) {
      const my = idx++;
      const batch = batches[my];
      try {
        await delCompat(batch);
        console.log(`[blob-delete] ok worker=${workerId} batch=${my + 1}/${batches.length} count=${batch.length}`);
      } catch (e: any) {
        console.warn(`[blob-delete] fail worker=${workerId} batch=${my + 1}/${batches.length}`, e?.message || e);
        for (const u of batch) {
          failed.push({ url: u, error: e?.message || String(e) });
        }
      }
    }
  }

  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i + 1)));

  if (failed.length) {
    console.log('\n[blob-delete] FAILED URLs:');
    for (const f of failed) {
      console.log(`${f.url}\t${f.error}`);
    }
    process.exitCode = 1;
  } else {
    console.log('[blob-delete] all done');
  }
}

main().catch((e) => {
  console.error('[blob-delete] fatal', e);
  process.exit(1);
});