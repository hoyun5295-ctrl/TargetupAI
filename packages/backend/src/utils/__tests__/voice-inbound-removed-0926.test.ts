/**
 * 음성 AI(인바운드 전화 응답) 제거 (★2026-09-26 Harold 결정 「음성 AI는 필요 없다 · 제거」)
 *
 * 근거(M-41 실측): 켠 회사 0 · 통화 이력 0(만든 뒤 한 번도 쓰이지 않음) · 메뉴 없는 실험실 화면(주소 직접 입력).
 * 남겨 두면 인증 없는 웹훅 입구 하나와, 고객 타임라인이 열릴 때마다 빈 통화 테이블을 읽는 조회가 남는다.
 * 제거 = 라우트·CT·네이버 음성 연동(다른 사용처 0)·화면·경로·기능 안내·단가·타임라인 '문의' 종류.
 * 남기는 것 = DB(빈 테이블 voice_inbound_calls · companies.voice_inbound_enabled) — 삭제는 별도 과제 ·
 *            프론트 크레딧 라벨 '음성 분석'(과거 사용 내역이 있으면 이름 없는 줄로 뜨지 않게 · 표시 전용).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const BE = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8');

describe('음성 AI 제거', () => {
  it('백엔드 라우트·CT·음성 연동 파일이 없다', () => {
    expect(existsSync(join(BE, 'routes', 'voice.ts'))).toBe(false);
    expect(existsSync(join(BE, 'utils', 'voice-inbound.ts'))).toBe(false);
    expect(existsSync(join(BE, 'utils', 'naver-clova-client.ts'))).toBe(false);
  });

  it('앱에 /api/voice가 등록되지 않는다', () => {
    const app = read(join(BE, 'app.ts'));
    expect(app).not.toContain("'/api/voice'");
    expect(app).not.toContain("from './routes/voice'");
  });

  it('단가·기능 안내에 음성 항목이 없다', () => {
    expect(read(join(BE, 'utils', 'ai-credit-calc.ts'))).not.toContain("'voice-inbound'");
    expect(read(join(BE, 'content', 'feature-catalog.ts'))).not.toContain('voice-inbound');
  });

  it("고객 타임라인에 '문의'(음성 통화) 종류가 없다", () => {
    const tl = read(join(BE, 'utils', 'customer-timeline.ts'));
    expect(tl).not.toContain('voice_inbound_calls');
    expect(tl).not.toContain("'inbound'");
    const kinds = read(join(FE, 'components', 'customer360', 'timeline-kinds.ts'));
    expect(kinds).not.toContain("'inbound'");
    expect(kinds).not.toMatch(/\binbound:/);
  });

  it('프론트 화면·경로가 없다', () => {
    expect(existsSync(join(FE, 'pages', 'VoiceInboundPage.tsx'))).toBe(false);
    const app = read(join(FE, 'App.tsx'));
    expect(app).not.toContain('/voice-inbound');
    expect(app).not.toContain('VoiceInboundPage');
  });
});
