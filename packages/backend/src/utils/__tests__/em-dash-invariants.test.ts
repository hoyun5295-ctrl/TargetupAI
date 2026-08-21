/**
 * 사용자 노출 문자열 줄표(em dash, U+2014) 0 불변식 (2026-08-21 신설)
 *
 * 기원: Harold "AI 티가 굉장히 많이 나는 게 글자 중간에 줄표를 넣는 거야. 네 특징이야."
 *   같은 날 프론트 969건·AI 프롬프트 590건·서버 노출 문자열을 전부 걷어냈다. 다시 쌓이지 않게 잠근다.
 *   (경위 = docs/2026-08-21-ai-operator-surface-design.md §13 · memory feedback_no_em_dash_in_copy)
 *
 * 이 파일이 잠그는 것
 *   - frontend/src · backend/src 전 파일(테스트 제외)에서 **주석과 내부 로그를 뺀 나머지**에 줄표가 없다.
 *   - 허용 = 표 빈칸 표시용 한 글자 리터럴('—' · JSX의 >—<)과 줄표를 치환 대상으로 나열한 문자 표(메시지 정제 정규식·치환표).
 *
 * 판정에서 빼는 것(사용자에게 보이지 않는다)
 *   - 블록 주석(JSX 주석 포함) · 줄 주석 · SQL 주석 줄
 *   - console.* / log·logErr·logWarn(...) / sendSystemAlert(...) 호출 인자 전체(여러 줄이어도 괄호 균형으로 끝까지)
 *   - *.verify.ts · *.manual-test.ts 같은 수동 검증 스크립트
 *
 * 대체 규칙(치환할 때): 나열은 "·", 부연은 ":" 또는 괄호, 문장이 둘이면 마침표로 나눈다. 코드 주석은 대상이 아니다.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { scanSources, SCAN_TIMEOUT_MS } from './source-scan';

const FRONT_SRC = resolve(__dirname, '../../../../frontend/src');
const BACK_SRC = resolve(__dirname, '../..');
const EM_DASH = '—';

/** 내부 로그·알림 호출. 인자 안의 문구는 운영자 로그/관리자 문자라 사용자 노출이 아니다. */
const INTERNAL_CALL = /\b(?:console\.\w+|log(?:Warn|Error|Err|Info)?|sendSystemAlert)\(/g;

/** 코드 뒤 줄 주석의 시작. 문자열 안 URL의 "//"는 ":" 뒤라 걸리지 않는다. */
const TRAILING_COMMENT = /(?:^|[\s;,)}])\/\//;

/** 블록 주석 · 줄 주석 · SQL 주석 줄을 지운다. */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map((line) => {
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('--') || t.startsWith('* ') || t === '*') return '';
      const m = TRAILING_COMMENT.exec(line);
      return m ? line.slice(0, m.index) : line;
    })
    .join('\n');
}

/** 내부 로그 호출을 괄호 균형으로 통째로 지운다(여러 줄 템플릿 인자 포함). */
function stripInternalCalls(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    INTERNAL_CALL.lastIndex = i;
    const m = INTERNAL_CALL.exec(src);
    if (!m) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, m.index);
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    i = j;
  }
  return out;
}

/** 허용 형태를 지운 뒤에도 줄표가 남으면 위반이다. */
function offendingLines(src: string): string[] {
  const code = stripInternalCalls(stripComments(src));
  const out: string[] = [];
  code.split('\n').forEach((line, idx) => {
    if (!line.includes(EM_DASH)) return;
    // 표 빈칸·치환표의 한 글자 리터럴, JSX 빈칸 셀
    let rest = line.replace(/(['"`])—\1/g, '').replace(/>—</g, '');
    // 줄표를 치환 대상으로 나열한 정규식 문자 표(메시지 정제)
    if (/[─—–]{2,}/.test(rest)) rest = '';
    if (rest.includes(EM_DASH)) out.push(`${idx + 1}: ${line.trim().slice(0, 120)}`);
  });
  return out;
}

describe('사용자 노출 문자열 줄표(em dash) 0 불변식', () => {
  it.each([
    ['frontend', FRONT_SRC],
    ['backend', BACK_SRC],
  ])('%s: 주석·내부 로그를 뺀 소스 어디에도 줄표가 없다', (_label, root) => {
    const files = scanSources(root).filter((f) => !/\.(verify|manual-test)\.ts$/.test(f.rel));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const { rel, src } of files) {
      for (const hit of offendingLines(src)) offenders.push(`${rel} :: ${hit}`);
    }
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it('판정기 자가 검증: 주석·로그·빈칸은 빼고, 문구의 줄표는 잡는다', () => {
    expect(offendingLines(`// 주석 — 대상 아님\nconst a = '빈칸 ' + '—';`)).toEqual([]);
    expect(offendingLines(`const x = 1;// 붙은 주석 — 대상 아님`)).toEqual([]);
    expect(offendingLines(`console.log(\n  \`시작 — boot\`,\n);\nconst b = 1;`)).toEqual([]);
    expect(offendingLines(`log('사이클 완료 — ok');\nlogErr('t', new Error(\`불일치 — code\`));`)).toEqual([]);
    expect(offendingLines(`<span className="x">—</span>`)).toEqual([]);
    expect(offendingLines(`const msg = '네트워크 오류 — 다시 시도';`)).toHaveLength(1);
    expect(offendingLines(`{/* JSX 주석 — 대상 아님 */}\n<p>발송 완료 — 확인</p>`)).toHaveLength(1);
    expect(offendingLines(`const u = 'https://a.b/c — 설명';`)).toHaveLength(1);
  });
});
