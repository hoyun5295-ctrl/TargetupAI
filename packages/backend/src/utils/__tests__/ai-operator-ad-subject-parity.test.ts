import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildAdSubject } from '../messageUtils';

/**
 * ★ 2026-07-22 (임은지 리포트 + Harold) — AI operator 광고표기 토글 + 제목 (광고) 표시 ↔ 발송 buildAdSubject 미러 게이트.
 *
 * [경위] 발송(prepareSendMessage→buildAdSubject)은 isAd+LMS/MMS 제목 맨 앞에 "(광고) "를 붙이는데 생성 화면 제목엔
 *   안 보여줘 혼동. 1차=캡션 표시 → Harold "제목 자체에 붙어야". 2차(확정)=직접발송처럼 광고표기 on/off 토글(기본 ON)
 *   + 제목 입력칸 앞 (광고) 고정 접두 오버레이. 값은 순수 제목 유지(백엔드가 부착·이중부착 없음), /direct-send는
 *   D143으로 사용자 광고체크(adEnabled)를 강제 없이 존중.
 * [게이트] 백엔드 buildAdSubject 형식 + 프론트 토글/표시/발송 배선을 함께 확인 — 한쪽만 바뀌면 화면≠발송.
 */

function read(cands: string[]): string {
  const p = cands.find((x) => fs.existsSync(x)) || '';
  return p ? fs.readFileSync(p, 'utf8') : '';
}

const operator = read([
  path.resolve(process.cwd(), '../frontend/src/pages/AiOperatorPage.tsx'),
  path.resolve(process.cwd(), 'packages/frontend/src/pages/AiOperatorPage.tsx'),
]);

describe('AI operator 광고표기 토글 + 제목 (광고) ↔ buildAdSubject 미러', () => {
  it('buildAdSubject: isAd+LMS/MMS 제목 맨 앞 "(광고) " 부착(중복·비광고·SMS 제외)', () => {
    expect(buildAdSubject('여름세일', 'LMS', true)).toBe('(광고) 여름세일');
    expect(buildAdSubject('여름세일', 'MMS', true)).toBe('(광고) 여름세일');
    expect(buildAdSubject('(광고) 여름세일', 'LMS', true)).toBe('(광고) 여름세일'); // 중복 방지
    expect(buildAdSubject('여름세일', 'SMS', true)).toBe('여름세일');   // SMS 미부착
    expect(buildAdSubject('여름세일', 'LMS', false)).toBe('여름세일');  // 정보성 미부착
  });

  it('AI operator: 광고표기 토글(기본ON)+제목 (광고) 접두 표시+발송 배선', () => {
    expect(operator, 'AiOperatorPage.tsx 못 찾음 — cwd=' + process.cwd()).toBeTruthy();
    // 상태(기본 ON) + on/off 토글 배선 (직접발송 미러)
    expect(operator).toContain('const [adEnabled, setAdEnabled] = useState(true)');
    expect(operator).toContain('광고표기');
    expect(operator).toContain('setAdEnabled(e.target.checked)');
    // 본문·제목 표시 = 토글 상태 단일 소스
    expect(operator).toContain('const isAd = adEnabled');
    // 제목 입력칸 앞 (광고) 접두 오버레이 (값은 순수 유지 — 접두는 표시용 span)
    expect(operator).toMatch(/pointer-events-none[^>]*>\(광고\)</);
    // 발송 payload가 토글 상태를 그대로 전송 (백엔드 D143 존중)
    expect(operator).toContain('adEnabled, //');
  });
});
