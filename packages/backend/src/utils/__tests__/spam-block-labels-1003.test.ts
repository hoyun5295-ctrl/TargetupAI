/**
 * 금칙어 차단 화면 표시명 계약 (★2026-10-03 전송자격인증 — 대외 제출 화면 H15 에 내부 코드가 보였다)
 *
 * 못 박는 것
 *   1. 탐지 · 차단 기록에 남는 경로 값(차감 앞 판정 · 큐 적재 길목이 넘기는 source)이 전부 화면 이름표에 있다.
 *      → 새 발송 경로가 생겨 이름표를 빠뜨리면 이 시험이 깨진다(화면에 원값이 다시 보이지 않게).
 *   2. 화면이 원값 대신 이름표 함수를 거치고, 출처 설명에 테이블 이름이 없다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { DIRECT_PIPELINE_SEND_TYPES } from '../send-type-axis';
import { readAdminScreenSource } from './source-scan';

const SRC = resolve(__dirname, '../..');
const FRONT = resolve(SRC, '../../frontend/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p, out); continue; }
    if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** checkSpamBlockBeforeCharge · bulkInsertSmsQueue 호출 인자에 실린 source 리터럴 */
function collectSpamSources(): Set<string> {
  const found = new Set<string>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const fn of ['checkSpamBlockBeforeCharge(', 'bulkInsertSmsQueue(']) {
      let i = text.indexOf(fn);
      while (i >= 0) {
        const args = text.slice(i, i + 700).split(/\)\s*;/)[0];
        for (const m of args.matchAll(/source:\s*'([a-z_]+)'/g)) found.add(m[1]);
        i = text.indexOf(fn, i + fn.length);
      }
    }
  }
  return found;
}

const labelsSrc = readFileSync(join(FRONT, 'constants/spam-block-labels.ts'), 'utf8');
const hitBlock = labelsSrc.slice(labelsSrc.indexOf('SPAM_HIT_SOURCE_LABEL'), labelsSrc.indexOf('};', labelsSrc.indexOf('SPAM_HIT_SOURCE_LABEL')));
const hitKeys = new Set([...hitBlock.matchAll(/^\s*([a-z_]+):\s*'/gm)].map((m) => m[1]));

describe('금칙어 화면 경로 이름표', () => {
  it('기록에 남는 경로 값이 전부 이름표에 있다', () => {
    const sources = collectSpamSources();
    expect(sources.size, '수집이 0이면 이 시험이 죽은 것이다').toBeGreaterThanOrEqual(4);
    // 직접발송 배관은 sendType 을 그대로 넘기고, 비어 있으면 direct_core 로 남긴다
    for (const v of DIRECT_PIPELINE_SEND_TYPES) sources.add(v);
    expect(readFileSync(join(SRC, 'utils/direct-send-core.ts'), 'utf8')).toContain("source: spec.sendType || 'direct_core'");
    sources.add('direct_core');
    const missing = [...sources].filter((s) => !hitKeys.has(s)).sort();
    expect(missing, '새 경로의 화면 이름표를 constants/spam-block-labels.ts 에 등록하라').toEqual([]);
  });

  it('화면은 원값 대신 이름표 함수를 쓰고, 출처 설명에 테이블 이름이 없다', () => {
    const page = readAdminScreenSource(); // ★ 2026-10-09 파일 분리 E 뒤 = 본체 + 옮겨 간 화면 합본
    expect(page).toContain('{resolveSpamHitSourceLabel(h.send_source)}');
    expect(page).toContain('{resolveSpamRuleSourceLabel(r.source)}');
    expect(page).not.toContain('(spam_block_hits)');
    expect(page).not.toContain("{h.send_source || '-'}");
  });
});
