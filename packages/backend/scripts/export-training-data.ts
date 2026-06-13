/**
 * export-training-data.ts — ai_training_logs + operator_proposals → 파인튜닝용 JSONL
 *
 * 실행(서버): cd packages/backend && JWT_SECRET=x npx ts-node scripts/export-training-data.ts [outDir]
 * 출력: <outDir>/{generation,preference,spam}.{train,val}.jsonl + 건수 요약
 *
 *   generation = 입력→메시지 SFT (userPrompt 있는 발송)
 *   preference = operator 제안 채택/거부 KTO (approved·auto_executed=desirable / rejected=undesirable)
 *   spam       = 메시지 피처 → block/pass 분류
 *
 * 마스킹은 적재 시점(training-logger)에서 이미 적용됨. 라벨·필드는 전부 실데이터에서만 도출.
 * 순수 변환·검증 = src/utils/export-training-core.ts (+ __tests__/export-training-core.verify.ts).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pool from '../src/config/database';
import {
  buildGenerationExample,
  buildPreferenceExample,
  buildSpamExample,
  splitTrainVal,
  type ChatExample,
  type KtoExample,
  type SpamExample,
} from '../src/utils/export-training-core';

function notNull<T>(x: T | null): x is T {
  return x !== null;
}

async function main(): Promise<void> {
  const outDir = process.argv[2] || path.join(process.cwd(), 'training-export');
  fs.mkdirSync(outDir, { recursive: true });

  // 1) 발송 로그 → 생성 SFT + 스팸 분류
  const logs = await pool.query(
    `SELECT user_prompt, final_message, message_type, is_ad, message_features, spam_blocked
       FROM ai_training_logs`,
  );
  const generation: ChatExample[] = logs.rows
    .map((r: any) => buildGenerationExample({
      userPrompt: r.user_prompt,
      finalMessage: r.final_message || '',
      messageType: r.message_type || '',
      isAd: !!r.is_ad,
    }))
    .filter(notNull);
  const spam: SpamExample[] = logs.rows
    .map((r: any) => buildSpamExample({ features: r.message_features || null, spamBlocked: r.spam_blocked }))
    .filter(notNull);

  // 2) operator 제안 → 선호 KTO (proposal_json에서 메시지 방어적 추출, objective는 operator join)
  const proposals = await pool.query(
    `SELECT p.proposal_json, p.status, o.objective
       FROM operator_proposals p
       LEFT JOIN continuous_operators o ON o.id = p.operator_id
      WHERE p.status IN ('approved', 'auto_executed', 'rejected')`,
  );
  const preference: KtoExample[] = proposals.rows
    .map((r: any) => {
      const pj = r.proposal_json || {};
      let message = '';
      if (Array.isArray(pj.messages)) {
        const first = pj.messages[0];
        message = String((first && (first.content || first.text)) || first || '');
      } else if (typeof pj.message === 'string') {
        message = pj.message;
      }
      return buildPreferenceExample({ objective: r.objective || '', message, status: r.status });
    })
    .filter(notNull);

  // 3) 학습/검증 분리 + JSONL 출력
  const writeSet = (name: string, items: unknown[]): void => {
    const { train, val } = splitTrainVal(items, 5);
    const toJsonl = (arr: unknown[]) => arr.map((x) => JSON.stringify(x)).join('\n') + (arr.length ? '\n' : '');
    fs.writeFileSync(path.join(outDir, `${name}.train.jsonl`), toJsonl(train));
    fs.writeFileSync(path.join(outDir, `${name}.val.jsonl`), toJsonl(val));
    console.log(`  ${name}: train ${train.length} / val ${val.length}`);
  };

  console.log(`[export] 출력 → ${outDir}`);
  writeSet('generation', generation);
  writeSet('preference', preference);
  writeSet('spam', spam);
  console.log('[export] 완료');
  await pool.end();
}

main().catch((e) => {
  console.error('[export] 실패:', e);
  process.exit(1);
});
