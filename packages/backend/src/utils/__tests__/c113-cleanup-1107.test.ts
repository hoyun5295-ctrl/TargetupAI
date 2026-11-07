/**
 * C113 정리 묶음(★ 2026-11-07 · 설계서 docs/2026-11-07-c113-structure-fix-design.md §2-L · §2-N · §2-K)
 *  - K15 · D16 · R80: 광고 원장 보존 = 보관 기한 CT 규칙 · 정의만 있고 부르지 않는 주기 일 0
 *  - K21 · D21: 임시 그림 영구 이동 = 크기를 옮기기 전에 읽는다
 *  - K10 · D14: 고객 이력 번호 지우기 = /\D/g
 *  - K18 · D18: 쓰는 곳 0 상수 없음
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from './helpers/producer-scan';

const SRC = join(__dirname, '..', '..');
const be = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('K15 · 광고 원장 보존 = 보관 기한 CT', () => {
  it('ad_send_marks = 연결 안 된 줄 3일 ∪ 모든 줄 400일 · 규칙 하나', async () => {
    const { RETENTION_RULES } = await import('../retention-sweeper');
    const marks = RETENTION_RULES.filter((r) => r.table === 'ad_send_marks');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ key: 'id', column: 'created_at', days: 3 });
    expect(marks[0].extraWhere).toBe("(campaign_id IS NULL OR created_at < NOW() - INTERVAL '400 days')");
  });
  it('ad_gate_failures = 400일', async () => {
    const { RETENTION_RULES } = await import('../retention-sweeper');
    expect(RETENTION_RULES.find((r) => r.table === 'ad_gate_failures')).toMatchObject({ key: 'id', column: 'created_at', days: 400 });
  });
  it('관문 CT 에 따로 도는 정리 함수(pruneAdSendMarks)가 없다', () => {
    expect(stripComments(be('utils/ad-send-gate.ts'))).not.toMatch(/\bpruneAdSendMarks\b/);
  });
});

describe('R80 · 정의만 있고 부르지 않는 주기 일 0', () => {
  const files: string[] = [];
  (function walk(d: string) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === '__tests__' || f === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push(p);
    }
  })(SRC);
  const code = new Map(files.map((p) => [p, stripComments(readFileSync(p, 'utf8'))]));
  const utilsFiles = files.filter((p) => relative(SRC, p).startsWith('utils'));
  it('utils 의 내보낸 정리 함수(prune* · sweep*)는 어디선가 불리고, 시작 함수(start*Worker · Sweeper · Flusher)는 자기 파일 밖(기동)에서 불린다', () => {
    const dead: string[] = [];
    for (const f of utilsFiles) {
      const s = code.get(f)!;
      for (const m of s.matchAll(/export\s+(?:async\s+)?function\s+((?:prune|sweep)\w*|start\w*(?:Worker|Sweeper|Flusher))\s*\(/g)) {
        const name = m[1];
        const re = new RegExp(`\\b${name}\\b`, 'g');
        const outside = [...code.entries()].some(([p, t]) => p !== f && new RegExp(`\\b${name}\\b`).test(t));
        const inside = (s.match(re) || []).length - 1;   // 정의 줄 빼고
        const ok = name.startsWith('start') ? outside : (outside || inside > 0);
        if (!ok) dead.push(`${relative(SRC, f)} :: ${name}`);
      }
    }
    expect(dead).toEqual([]);
  });
});

describe('K21 · 임시 그림 영구 이동 = 크기를 옮기기 전에', () => {
  it('moveTempToPermanent 몸에서 크기 읽기가 이름 바꾸기보다 앞 · 옮긴 자리 크기 읽기 0', () => {
    const s = stripComments(be('utils/image-studio.ts'));
    const body = s.slice(s.indexOf('export function moveTempToPermanent('), s.indexOf('export function writeStudioPermanent('));
    expect(body.length).toBeGreaterThan(100);
    const stat = body.indexOf('fs.statSync(found.absPath)');
    const rename = body.indexOf('fs.renameSync(');
    expect(stat).toBeGreaterThan(0);
    expect(rename).toBeGreaterThan(stat);
    expect(body).not.toContain('fs.statSync(destPath)');
  });
});

describe('K10 · 고객 이력 번호 지우기', () => {
  it('광고 제외 사건의 번호 맞춤 = /\\D/g(숫자만)', () => {
    const s = be('utils/customer-timeline.ts');
    expect(s).not.toContain('.replace(/D/g,');
    expect(s).toContain(".replace(/\\D/g, '')");
  });
});

describe('K18 · 쓰는 곳 0 상수', () => {
  it('AD_EXCLUDE_REASONS 가 없다', () => {
    expect(be('utils/ad-send-gate-core.ts')).not.toMatch(/\bAD_EXCLUDE_REASONS\b/);
  });
});

/**
 * K25 · 발행 소스(문자열 · 템플릿 안에 실려 받는 사람 브라우저로 나가는 CSS · JS 주석)에 내부 표지 0.
 * 판정 = 공용 주석 지우기(TS 주석만 지움) 뒤에도 남는 주석 꼴 줄. em dash 는 em-dash 불변식이 같은 줄을 본다.
 * ponytail: 직원 이름은 손 목록(올린 이름만 막음) · 접수 어휘(신고 · 접수 · 리포트) · 리뷰 표지 · 접수 번호 꼴은 이름 없이도 잡는다.
 */
describe('K25 · 발행 소스 안 주석 = 내부 표지 0', () => {
  const MARK = /신고|접수|리포트|박성용|임은지|남지현|Codex|Harold|#\d|\bC\d{2,3}\b|\bR\d{1,3}\b|\bD\d{2,3}\b|[a-z0-9]{20,}/;
  const shipped: string[] = [];
  (function walk(d: string) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === '__tests__' || f === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.ts') && !/\.(test|verify|manual-test)\.ts$/.test(f)) {
        stripComments(readFileSync(p, 'utf8')).split('\n').forEach((line, i) => {
          const t = line.trimStart();
          if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('* ') || t.startsWith('<!--')) shipped.push(`${relative(SRC, p)}:${i + 1}: ${t}`);
        });
      }
    }
  })(SRC);
  it('발행 소스 안 주석 줄을 실제로 본다(판정이 비지 않음)', () => {
    expect(shipped.length).toBeGreaterThan(50);
  });
  it('그 줄에 직원 이름 · 접수 어휘 · 리뷰 표지 · 접수 번호가 없다', () => {
    expect(shipped.filter((l) => MARK.test(l.slice(l.indexOf(': ') + 2)))).toEqual([]);
  });
});
