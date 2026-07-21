import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildAdSubject } from '../messageUtils';

/**
 * ★ 2026-07-21 (임은지 리포트) — AI operator 생성 화면 "실제 발송 제목" 표시 ↔ 발송 buildAdSubject 미러 게이트.
 *
 * [근본] 발송(prepareSendMessage→buildAdSubject)은 isAd+LMS/MMS 제목 맨 앞에 "(광고) "를 붙이는데,
 *   생성 화면 제목엔 안 보여줘 "발송엔 (광고) 붙는데 화면엔 없다"는 혼동이 났다.
 * [수정] 생성 화면 제목 입력창 아래에 실제 발송 제목((광고) 포함)을 표시(값은 순수 제목 유지 = 이중부착 없음).
 * [게이트] 화면 표시가 백엔드 buildAdSubject와 어긋나면 또 불일치 → 형식(“(광고) ” 접두 + 반각/전각 중복 방지)을
 *   양쪽에서 확인. buildAdSubject를 바꾸면 화면 미러도 같이 바꾸도록 강제.
 */

function read(cands: string[]): string {
  const p = cands.find((x) => fs.existsSync(x)) || '';
  return p ? fs.readFileSync(p, 'utf8') : '';
}

const operator = read([
  path.resolve(process.cwd(), '../frontend/src/pages/AiOperatorPage.tsx'),
  path.resolve(process.cwd(), 'packages/frontend/src/pages/AiOperatorPage.tsx'),
]);

describe('AI operator 제목 (광고) 표시 ↔ buildAdSubject 미러', () => {
  it('buildAdSubject: isAd+LMS/MMS 제목 맨 앞 "(광고) " 부착(중복·비광고·SMS 제외)', () => {
    expect(buildAdSubject('여름세일', 'LMS', true)).toBe('(광고) 여름세일');
    expect(buildAdSubject('여름세일', 'MMS', true)).toBe('(광고) 여름세일');
    expect(buildAdSubject('(광고) 여름세일', 'LMS', true)).toBe('(광고) 여름세일'); // 중복 방지
    expect(buildAdSubject('여름세일', 'SMS', true)).toBe('여름세일');   // SMS 미부착
    expect(buildAdSubject('여름세일', 'LMS', false)).toBe('여름세일');  // 정보성 미부착
  });

  it('AiOperatorPage에 실제 발송 제목((광고) 미러) 표시가 있다', () => {
    expect(operator, 'AiOperatorPage.tsx 못 찾음 — cwd=' + process.cwd()).toBeTruthy();
    expect(operator).toContain('실제 발송 제목');
    // buildAdSubject와 동일: "(광고) " 접두
    expect(operator).toContain('(광고) ${resolveSubject(safeIdx)}');
    // buildAdSubject와 동일: 반각·전각 (광고) 중복 방지 정규식
    expect(operator).toContain('[(（]\\s*광고\\s*[)）]');
  });
});
