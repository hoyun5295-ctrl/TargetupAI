/**
 * seed v3 계약 테스트 — 실행 SQL 파일(scripts/sql)의 원문을 그대로 파싱해 잠근다 (2026-08-16 · v3 설계서 §7)
 * seed 원문 소유 = scripts/sql/2026-08-16-diagnosis-seed-v3.sql (설계서 §7은 포인터 — 사본 금지)
 *
 * 잠그는 것
 *   1. JSON이 실제로 파싱되고 validateDefinition(로더와 같은 검증기)을 통과한다 —
 *      Harold가 실행할 SQL이 활성화 즉시 503이 되는 사고를 배포 전에 잡는다(V-11의 역방향).
 *   2. 문진 안 광고 0 — 문항·선택지·힌트에 자사명 금지(v2 want_hanjul 같은 "문진 속 배너" 재발 방지).
 *   3. 사용자 노출 문구에 문장 속 대시(—) 0 · est_label에 문항 수 표기 금지(m5 — 분기형에서 숫자는 거짓).
 *   4. 실측 선치환 매핑(s1_2/s3_5/s6p)이 sending 게이트에 실존한다(computeSendingPrefill 결합).
 *
 * 설계서 경로가 바뀌면 이 테스트를 함께 옮긴다(계약: 백엔드 러너가 문서를 읽는 선례 — LESSONS_FRONTEND 11행).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateDefinition, visibleQuestions, type DiagnosisDefinition } from './plan-recommend';

const SEED_SQL = resolve(__dirname, '../../../../scripts/sql/2026-08-16-diagnosis-seed-v3.sql');

function loadSeedV3(): DiagnosisDefinition {
  const text = readFileSync(SEED_SQL, 'utf-8');
  const m = text.match(/VALUES \('v3', \$\$\s*([\s\S]*?)\$\$::jsonb/);
  if (!m) throw new Error('seed SQL 파일에서 v3 블록을 찾지 못함');
  return JSON.parse(m[1]) as DiagnosisDefinition;
}

describe('seed v3 (설계서 §7 원문)', () => {
  const def = loadSeedV3();

  it('validateDefinition(로더 검증기)을 통과한다 — 활성화 즉시 503 사고 차단', () => {
    const r = validateDefinition(def);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(def.version).toBe('v3');
  });

  it('문진 안 광고 0 — 문항·선택지·힌트·섹션 문구에 자사명 금지', () => {
    const surfaces: string[] = [];
    for (const s of def.meta?.sections ?? []) surfaces.push(s.label, s.intro ?? '');
    for (const q of def.questions) {
      surfaces.push(q.text);
      for (const o of q.options) surfaces.push(o.label, o.hint ?? '');
    }
    expect(surfaces.join(' ')).not.toContain('한줄로');
  });

  it('사용자 노출 문구에 대시(—) 0 · est_label에 문항 수 없음', () => {
    const surfaces: string[] = [def.meta?.est_label ?? ''];
    for (const s of def.meta?.sections ?? []) surfaces.push(s.label, s.intro ?? '');
    for (const q of def.questions) {
      surfaces.push(q.text);
      for (const o of q.options) surfaces.push(o.label, o.hint ?? '');
    }
    expect(surfaces.join(' ')).not.toContain('—');
    expect(def.meta?.est_label ?? '').not.toMatch(/\d+\s*문항/);
  });

  it('실측 선치환 매핑 키(s1_2·s3_5·s6p)가 sending 게이트에 실존한다', () => {
    const sending = def.questions.find((q) => q.axis === 'sending');
    expect(sending).toBeDefined();
    const keys = new Set(sending!.options.map((o) => o.key));
    for (const k of ['s1_2', 's3_5', 's6p']) expect(keys.has(k)).toBe(true);
  });

  it('경로 길이 — 최소·최대 경로가 13~20문항 안에 있다(완주율 계약)', () => {
    // 최소 경로: 전 게이트 하위 + 분기 최소 조합
    const minAnswers: Record<string, string> = {
      industry: 'etc', touchpoint: 'offline', owner: 'self',
      list: 'none', targeting: 'never', sending: 'zero', repeat: 'none',
      production: 'none', measure: 'none',
      scale_customers: 'none', scale_send: 'u10k', scale_ai: 'none',
    };
    // 열린 분기를 첫 보기로 채워 가시 집합 확정
    let vis = visibleQuestions(def, minAnswers);
    for (const q of vis) if (minAnswers[q.key] === undefined) minAnswers[q.key] = q.options[0].key;
    vis = visibleQuestions(def, minAnswers);
    expect(vis.length).toBeGreaterThanOrEqual(13);

    const maxAnswers: Record<string, string> = {
      industry: 'fitness', touchpoint: 'both', owner: 'agency',
      list: 'scattered', targeting: 'all', sending: 's6p', repeat: 'manual',
      production: 'self', measure: 'revenue',
      scale_customers: 'u100k', scale_send: 'k10_100k', scale_ai: 'u10',
    };
    let vis2 = visibleQuestions(def, maxAnswers);
    for (const q of vis2) if (maxAnswers[q.key] === undefined) maxAnswers[q.key] = q.options[0].key;
    vis2 = visibleQuestions(def, maxAnswers);
    expect(vis2.length).toBeLessThanOrEqual(20);
  });
});
