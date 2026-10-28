/**
 * purge-rendered-training-rows.ts — 학습 원장의 고객 렌더본 행 정리(★ 2026-10-28 AI 메모리 설계 K10-4 · DML-1 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 왜: 여정 발송 · 알림톡 큐는 학습 원장에 첫 고객에게 나간 렌더본(이름 · 쿠폰이 든 글)을 적재했다. K10-1 이 원천을 템플릿 원문으로 바꿨고,
 *     이미 쌓인 행을 지운다. 식별 = 내용이 아니라 출처(여정 · 알림톡 캠페인 id 를 앱에서 해시해 source_ref 로 맞춘다).
 *
 * 지킴:
 *   - --before=<K10-1 배포 시각 ISO> 필수(그 뒤에 쌓인 템플릿 원문 행은 지우지 않는다)
 *   - 기본 = 읽기만(건수 출력) · 지우기 = --apply --expect=<점검 건수> 일 때만 · REPEATABLE READ 한 트랜잭션 · 다시 센 수 ≠ expect = 중단
 *   - 지우기 전에 지울 행 전부를 새 파일(독점 생성 · 권한 600 · JSON 한 줄씩)로 남긴다 · 지운 수 = 센 수가 아니면 롤백
 *   - 해시 키 = 서버 .env 의 학습 원장 키(운영 서버 packages/backend 에서 실행 · 키 값은 출력하지 않는다)
 *
 * 실행(운영 서버 · packages/backend):
 *   점검: npx ts-node scripts/purge-rendered-training-rows.ts --before=2026-11-01T09:00:00+09:00
 *   삭제: npx ts-node scripts/purge-rendered-training-rows.ts --before=2026-11-01T09:00:00+09:00 --apply --expect=<점검 건수>
 */
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pool from '../src/config/database';
import { getSourceRef } from '../src/utils/training-logger';

const BATCH = 1000;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const beforeArg = args.find((a) => a.startsWith('--before='));
  const before = beforeArg ? new Date(beforeArg.slice('--before='.length)) : null;
  const apply = args.includes('--apply');
  const expectArg = args.find((a) => a.startsWith('--expect='));
  const expect = expectArg ? Number(expectArg.split('=')[1]) : NaN;
  if (!before || isNaN(before.getTime())) throw new Error('--before=<K10-1 배포 시각 ISO> 가 필요합니다.');
  if (apply && !Number.isInteger(expect)) throw new Error('--apply 에는 --expect=<점검 건수> 가 필요합니다.');

  const client = await pool.connect();
  try {
    await client.query(apply ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
    if (apply) await client.query(`SET LOCAL lock_timeout = '5s'`);
    // 출처 = 여정 단계 캠페인 · 알림톡 캠페인(카카오는 message_type 이 아니라 send_channel 로 구분 · journey-step-campaign.ts 70)
    const camps = await client.query(`SELECT id FROM campaigns WHERE send_type = 'journey' OR send_channel = 'alimtalk'`);
    const refs = camps.rows.map((r: any) => getSourceRef(String(r.id)));
    let total = 0;
    const byType: Record<string, number> = {};
    for (let i = 0; i < refs.length; i += BATCH) {
      const part = refs.slice(i, i + BATCH);
      const r = await client.query(
        `SELECT message_type, COUNT(*)::int AS n FROM ai_training_logs
          WHERE source_ref = ANY($1::text[]) AND created_at < $2
          GROUP BY message_type`,
        [part, before.toISOString()],
      );
      for (const row of r.rows as any[]) { byType[row.message_type] = (byType[row.message_type] || 0) + row.n; total += row.n; }
    }
    console.log(`[purge-rendered] 출처 캠페인 ${camps.rows.length}개 · 지울 행 ${total}건 (${before.toISOString()} 앞)`);
    for (const [t, n] of Object.entries(byType)) console.log(`  - ${t}: ${n}건`);
    if (!apply) { await client.query('ROLLBACK'); console.log('[purge-rendered] 읽기만 했습니다. 지우려면 --apply --expect=<위 건수>'); return; }
    if (total !== expect) throw new Error(`다시 센 수 ${total} ≠ expect ${expect}. 중단합니다.`);

    const file = path.join(os.homedir(), `purge-rendered-training-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    const fd = fs.openSync(file, 'wx', 0o600);
    let deleted = 0;
    try {
      for (let i = 0; i < refs.length; i += BATCH) {
        const part = refs.slice(i, i + BATCH);
        const rows = await client.query(`SELECT * FROM ai_training_logs WHERE source_ref = ANY($1::text[]) AND created_at < $2`, [part, before.toISOString()]);
        for (const row of rows.rows) fs.writeSync(fd, `${JSON.stringify(row)}\n`);
        const d = await client.query(`DELETE FROM ai_training_logs WHERE source_ref = ANY($1::text[]) AND created_at < $2`, [part, before.toISOString()]);
        deleted += d.rowCount || 0;
      }
    } finally {
      fs.closeSync(fd);
    }
    if (deleted !== total) throw new Error(`지운 수 ${deleted} ≠ 센 수 ${total}. 되돌립니다.`);
    await client.query('COMMIT');
    console.log(`[purge-rendered] ${deleted}건 지움 · 백업 = ${file}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[purge-rendered] 실패:', err?.message || err);
  process.exit(1);
});
