/**
 * ★2026-10-15 B-1015-2 AI 오퍼레이션 LMS 제목 잘림 고정
 *   - 허브만 제목을 17자로 잘랐고(다른 발송 화면 40 · 큐 title_str 200) AI 는 제목에 「[브랜드명] 」 을 넣는다 → 「쿠폰 아직 못 받」.
 *   - 수정 = 프론트 CT 상수 LMS_SUBJECT_MAX_CHARS(40) 하나를 허브의 세 자리(표시 산출 · 발송 · 입력칸)가 쓴다 ·
 *     AI 프롬프트의 제목 규칙을 본문 줄 규칙(한 줄 17자)과 분리해 "공백 포함 20자(40바이트) · 브랜드 표기 포함" 으로 명시.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const page = read('frontend/src/pages/AiLinePage.tsx');   // ★ 2026-10-18 한 줄 입력 · 제안 · 발송은 AiLinePage.tsx 로 원형 이동(AI 한줄로 설계서 §4)
const fmt = read('frontend/src/utils/formatDate.ts');
const svc = read('backend/src/services/ai.ts');

describe('허브 LMS/MMS 제목 상한 = 다른 발송 화면과 같은 40자(CT 상수 하나)', () => {
  it('프론트 CT 가 상수를 소유한다', () => {
    expect(fmt).toContain('export const LMS_SUBJECT_MAX_CHARS = 40;');
  });
  it('허브의 세 자리(표시 산출 · 발송 · 입력칸)가 그 상수를 쓰고 17 은 남아 있지 않다', () => {
    expect(page).toContain("import { validateMmsBeforeSend, LMS_SUBJECT_MAX_CHARS } from '../utils/formatDate';");
    expect(page).toContain(".slice(0, LMS_SUBJECT_MAX_CHARS);");
    expect(page).toContain("resolveSubject(idx).slice(0, LMS_SUBJECT_MAX_CHARS)");
    expect(page).toContain('maxLength={LMS_SUBJECT_MAX_CHARS}');
    expect(page).toContain('placeholder={`제목 입력 (최대 ${LMS_SUBJECT_MAX_CHARS}자)`}');
    expect(page).not.toContain('slice(0, 17)');
    expect(page).not.toContain('maxLength={17}');
    expect(page).not.toContain('최대 17자');
  });
  it('다른 발송 화면의 40 과 같다(자동 마케팅 미리보기 · AI 캠페인 발송 창 · DM)', () => {
    expect(read('frontend/src/components/automarketing/OperatorPreviewModal.tsx')).toContain('maxLength={40}');
    expect(read('frontend/src/components/AiCampaignSendModal.tsx')).toContain('maxLength={40}');
    expect(read('frontend/src/components/DmSendAndTrackModal.tsx')).toContain('maxLength={40}');
  });
});

describe('허브가 실제로 쓰는 generateMessages(BRAND_SYSTEM_PROMPT)의 제목 규칙 — Codex 1R: 허브 경로 = orchestrate → generateMessages', () => {
  const sys = svc.slice(svc.indexOf('const BRAND_SYSTEM_PROMPT = `'), svc.indexOf('export async function generateMessages('));
  it('제목 = 공백·브랜드 표기 포함 40바이트(20자) · 브랜드가 길면 제목에서 브랜드 표기를 뺀다 · 본문 줄 17자 규칙은 따로 남는다', () => {
    expect(sys).toContain('- subject(제목) 필수! 공백·브랜드 표기까지 포함해 40바이트(한글 20자) 이내, 핵심 키워드로 짧고 임팩트 있게');
    // Codex 2R(KISA · 전송자 명칭은 광고 본문보다 앞): 브랜드를 빼라가 아니라 문구를 줄여라 · 뺄 때는 본문 첫 줄 [브랜드]
    expect(sys).toContain('- ⚠️ 브랜드명이 길어 제목이 20자를 넘기면 제목 문구를 더 줄이세요. 제목에서 브랜드 표기를 뺄 때는 본문 첫 줄을 반드시 [브랜드]로 시작하세요(전송자 명칭은 광고 본문보다 앞에 있어야 합니다)');
    expect(sys).not.toContain('본문 끝에 [브랜드]가 들어가므로 제목에 꼭 넣지 않아도 됩니다');
    expect(sys).toContain('- ⚠️ 제목 길이 = 브랜드 표기까지 포함해 한글 20자(40바이트) 이내. 브랜드명이 길면 제목 문구를 줄이고, 제목에 [브랜드]를 못 넣으면 본문 첫 줄을 [브랜드]로 시작하세요');
    expect(sys).toContain('- ⚠️ 한 줄은 반드시 한글 기준 최대 17자(34바이트) 이내! 모바일에서 줄넘김 방지');
    // 허브 오케스트레이터가 부르는 함수가 generateMessages 인 것을 고정
    const orch = read('backend/src/services/ai-orchestrator.ts');
    expect((orch.match(/await generateMessages\(/g) || []).length).toBe(2);
  });
});

describe('AI 문안 생성 프롬프트(generateCustomMessages · 직접 생성)의 제목 규칙 = 본문 줄 규칙과 분리', () => {
  const start = svc.indexOf('## 채널: ${channel}');
  const gen = svc.slice(start, svc.indexOf('## 요청사항', start));
  it('제목 = 공백 포함 20자(40바이트) · 브랜드 표기까지 포함 · 본문 줄 17자는 따로', () => {
    expect(gen).toContain('subject(제목) 필수 · 공백 포함 20자(40바이트) 이내 · 브랜드 표기 "[${brandName}]" 를 제목에 넣으면 그 글자까지 포함해 20자 이내 · 이모지 금지');
    expect(gen).toContain('- 본문은 한 줄 최대 17자 이내로 짧게 줄바꿈');
    expect(gen).not.toContain('subject(제목) 필수, 한 줄 최대 17자 이내로 짧게 줄바꿈');
    // 시스템 프롬프트의 LMS 규칙(40바이트)과 같은 길이 기준
    expect(svc).toContain('- subject(제목) 필수! 40바이트 이내');
  });
});
