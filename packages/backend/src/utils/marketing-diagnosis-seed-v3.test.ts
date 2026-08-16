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
import { validateDefinition, visibleQuestions, type DiagnosisDefinition, type DiagnosisAxis } from './plan-recommend';
import { HANJUL_FILLS } from './marketing-diagnosis-copy';

const SEED_SQL = resolve(__dirname, '../../../../scripts/sql/2026-08-16-diagnosis-seed-v5.sql');

function loadSeedV3(): DiagnosisDefinition {
  const text = readFileSync(SEED_SQL, 'utf-8');
  const m = text.match(/VALUES \('v5', \$\$\s*([\s\S]*?)\$\$::jsonb/);
  if (!m) throw new Error('seed SQL 파일에서 v5 블록을 찾지 못함');
  return JSON.parse(m[1]) as DiagnosisDefinition;
}

describe('seed v5 (현행 활성 seed 원문 — scripts/sql)', () => {
  const def = loadSeedV3();

  it('validateDefinition(로더 검증기)을 통과한다 — 활성화 즉시 503 사고 차단', () => {
    const r = validateDefinition(def);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(def.version).toBe('v5');
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

  /**
   * v6 — 킥 원장의 변형 키가 현행 seed에서 실제로 선택될 수 있는가.
   * 킥은 병목(축 level ≤ 1)에만 붙으므로, 그 축이 상위 등급일 때만 열리는 분기에 변형을 걸면
   * 영원히 안 나가는 죽은 문장이 된다(v5 원장에 그 부류가 이미 있다 — 별도 과제).
   * 분기의 분기가 금지돼 있어(validateDefinition) 분기 가시성은 참조 문항 답 하나로 결정된다.
   */
  function variantReachable(d: DiagnosisDefinition, axis: DiagnosisAxis, variantKey: string): boolean {
    const [qKey, aKey] = variantKey.split(':');
    const q = d.questions.find((x) => x.key === qKey);
    if (!q || !q.options.some((o) => o.key === aKey)) return false;   // 없는 문항·보기
    const gate = d.questions.find((x) => x.axis === axis);
    if (!gate) return false;
    const lowKeys = new Set(
      gate.options.filter((o, i) => (o.level ?? i) <= 1).map((o) => o.key),
    );
    if (lowKeys.size === 0) return false;                              // 병목이 될 수 없는 축
    if (!q.show_when) return true;                                     // 항상 보이는 문항
    if (q.show_when.q !== gate.key) return true;                       // 다른 축의 분기 — 독립 조합 가능
    return q.show_when.in.some((k) => lowKeys.has(k));                 // 같은 축이면 하위 등급에서 열려야 한다
  }

  it('킥 원장(v6) — 모든 변형 키가 이 seed에서 도달 가능하다(죽은 문장 0)', () => {
    const dead: string[] = [];
    for (const [axis, table] of Object.entries(HANJUL_FILLS)) {
      for (const variantKey of Object.keys(table.variants ?? {})) {
        if (!variantReachable(def, axis as DiagnosisAxis, variantKey)) dead.push(`${axis} / ${variantKey}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('킥 원장(v6) — 6축 전부 default 문장을 갖는다(병목인데 킥이 비는 카드 0)', () => {
    const axes = def.questions.filter((q) => q.axis).map((q) => q.axis as DiagnosisAxis);
    expect(axes.length).toBe(6);
    for (const axis of axes) expect(HANJUL_FILLS[axis]?.default, `${axis} default 누락`).toBeTruthy();
  });

  it('경로 길이 — 최소·최대 경로가 13~22문항 안에 있다(완주율 계약 · v4 도구 축 +2)', () => {
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
      list: 'locked', targeting: 'all', sending: 's6p', repeat: 'manual',
      production: 'self', measure: 'revenue',
      scale_customers: 'u100k', scale_send: 'k10_100k', scale_ai: 'u10',
    };
    let vis2 = visibleQuestions(def, maxAnswers);
    for (const q of vis2) if (maxAnswers[q.key] === undefined) maxAnswers[q.key] = q.options[0].key;
    vis2 = visibleQuestions(def, maxAnswers);
    expect(vis2.length).toBeLessThanOrEqual(22);
  });
});
