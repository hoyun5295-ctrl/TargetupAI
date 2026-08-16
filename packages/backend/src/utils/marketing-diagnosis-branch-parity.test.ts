/**
 * 문진 분기 판정 계약 — 화면(위저드) ↔ 서버(plan-recommend) 대조 + 선치환 회귀 (2026-08-17)
 *
 * 기원: 퍼널 A에서 **최근 30일 발송 이력이 있는 회사가 문진을 끝낼 수 없었다**(Harold 실측).
 *   `sending`은 서버 실측으로 선치환돼 `prefilled`에만 있는데, 위저드의 가시성 판정이 두 벌이었다 —
 *   렌더는 `{...prefilled, ...answers}`로 보고, 답 정리(pruneAnswers)는 `answers`만 봤다.
 *   그래서 선치환 게이트의 분기(manual_ratio·send_tool)에 답하는 순간 그 답이 고아로 삭제되고
 *   커서가 같은 문항으로 되돌아왔다. 선택지와 무관하게 막힌다.
 *
 * 잠그는 것
 *   1. 프론트 `visiblePath` = 서버 `visibleQuestions` (실 seed 원문으로 경로 여러 개 대조)
 *   2. **렌더가 보여준 문항의 답을 prune이 지우지 않는다**(선치환 포함) — 위 사고의 회귀
 *   3. 게이트 답을 바꾸면 고아 답은 지우고, 되돌아오면 stash에서 복원한다(기존 동작 보존)
 *
 * 백엔드 러너가 프론트 소스를 읽는 선례 = brand-axis-invariants.test.ts(campaign-axis CT 직접 import).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { visibleQuestions, type DiagnosisDefinition } from './plan-recommend';
// 화면이 실제로 쓰는 판정 그 자체를 불러온다(문자열 대조가 아니라 실행 대조)
import { visiblePath, pruneAnswers } from '../../../frontend/src/utils/diagnosis-branch';

const SEED_SQL = resolve(__dirname, '../../../../scripts/sql/2026-08-16-diagnosis-seed-v5.sql');

function loadSeed(): DiagnosisDefinition {
  const text = readFileSync(SEED_SQL, 'utf-8');
  const m = text.match(/VALUES \('v5', \$\$\s*([\s\S]*?)\$\$::jsonb/);
  if (!m) throw new Error('seed SQL 파일에서 v5 블록을 찾지 못함');
  return JSON.parse(m[1]) as DiagnosisDefinition;
}

const def = loadSeed();
const keysOf = (qs: Array<{ key: string }>) => qs.map((q) => q.key);

/** 게이트 6축 + 대표 분기를 훑는 경로들(선치환 유무 양쪽). */
const PATHS: Array<{ name: string; answers: Record<string, string>; prefilled?: Record<string, string> }> = [
  {
    name: '전 축 하위(선치환 없음)',
    answers: {
      industry: 'etc', touchpoint: 'offline', owner: 'self',
      list: 'none', targeting: 'never', sending: 'zero', repeat: 'none',
      production: 'none', measure: 'none',
    },
  },
  {
    name: '갇힌 명단 + 전체 발송(선치환 없음)',
    answers: {
      industry: 'fitness', touchpoint: 'both', owner: 'agency',
      list: 'locked', targeting: 'all', sending: 's1_2', repeat: 'manual',
      production: 'self', measure: 'counts',
    },
  },
  {
    name: '★퍼널 A — sending 선치환(s6p)',
    answers: {
      industry: 'fitness', touchpoint: 'offline', owner: 'self',
      list: 'unified', targeting: 'all', repeat: 'manual',
      production: 'none', measure: 'counts',
    },
    prefilled: { sending: 's6p' },
  },
  {
    name: '★퍼널 A — sending 선치환(s1_2)',
    answers: {
      industry: 'cafe', touchpoint: 'offline', owner: 'staff',
      list: 'scattered', targeting: 'demo', repeat: 'scheduled',
      production: 'outsource', measure: 'clicks',
    },
    prefilled: { sending: 's1_2' },
  },
];

describe('문진 분기 — 화면 판정과 서버 판정이 같다', () => {
  for (const p of PATHS) {
    it(`같은 가시 집합: ${p.name}`, () => {
      const eff = { ...(p.prefilled ?? {}), ...p.answers };
      expect(keysOf(visiblePath(def.questions, eff))).toEqual(keysOf(visibleQuestions(def, eff)));
    });
  }
});

describe('문진 분기 — prune이 화면에 보인 문항의 답을 지우지 않는다', () => {
  /** 선치환 게이트가 연 분기에 답하는 순간 그 답이 살아남아야 커서가 앞으로 간다. */
  it('★회귀 — 선치환(sending=s6p)이 연 manual_ratio 답이 prune 후에도 남는다', () => {
    const prefilled = { sending: 's6p' };
    const answers: Record<string, string> = {
      industry: 'fitness', touchpoint: 'offline', owner: 'self',
      list: 'unified', unified_tool: 'crm', targeting: 'all', optout_check: 'many',
      repeat: 'manual', manual_count: 'c6_10', production: 'none', copy_how: 'reuse',
      measure: 'counts', measure_reason: 'no_time',
    };
    // 화면이 실제로 보여 준 문항인지부터 확인(전제 고정)
    const shown = keysOf(visiblePath(def.questions, { ...prefilled, ...answers }));
    expect(shown).toContain('manual_ratio');

    const picked = { ...answers, manual_ratio: 'all_manual' };
    const pruned = pruneAnswers(def.questions, picked, {}, prefilled);
    expect(pruned.manual_ratio).toBe('all_manual');
  });

  it('★회귀 — 선치환(sending=s1_2)이 연 send_tool 답도 남는다', () => {
    const prefilled = { sending: 's1_2' };
    const answers: Record<string, string> = {
      industry: 'cafe', touchpoint: 'offline', owner: 'staff',
      list: 'scattered', inflow_capture: 'mostly', targeting: 'demo',
      repeat: 'none', production: 'none', copy_how: 'new', measure: 'none', measure_reason: 'dont_know',
    };
    expect(keysOf(visiblePath(def.questions, { ...prefilled, ...answers }))).toContain('send_tool');

    const pruned = pruneAnswers(def.questions, { ...answers, send_tool: 'mixed' }, {}, prefilled);
    expect(pruned.send_tool).toBe('mixed');
  });

  it('선치환된 게이트 자체는 사용자 답으로 새어 들어가지 않는다', () => {
    const prefilled = { sending: 's6p' };
    const pruned = pruneAnswers(
      def.questions,
      { industry: 'etc', touchpoint: 'offline', owner: 'self', list: 'none', inflow_capture: 'mostly', targeting: 'never', repeat: 'none', production: 'none', copy_how: 'new', measure: 'none', measure_reason: 'no_need' },
      {},
      prefilled,
    );
    expect(pruned.sending).toBeUndefined();
  });
});

describe('문진 분기 — 고아 제거·복원(기존 동작 보존)', () => {
  it('게이트 답을 바꾸면 닫힌 분기 답이 지워지고, 되돌아오면 복원된다', () => {
    const stash: Record<string, string> = {};
    const base: Record<string, string> = {
      industry: 'etc', touchpoint: 'offline', owner: 'self',
      list: 'locked', locked_tool: 'pos', targeting: 'never', sending: 'zero', no_send_reason: 'no_list',
      repeat: 'none', production: 'none', copy_how: 'new', measure: 'none', measure_reason: 'no_need',
    };
    // list를 unified로 바꾸면 locked_tool은 닫힌다
    const changed = pruneAnswers(def.questions, { ...base, list: 'unified' }, stash);
    expect(changed.locked_tool).toBeUndefined();
    expect(stash.locked_tool).toBe('pos');

    // 다시 locked로 돌아오면 같은 답이 복원된다(재질문 없음)
    const back = pruneAnswers(def.questions, { ...changed, list: 'locked' }, stash);
    expect(back.locked_tool).toBe('pos');
  });
});
