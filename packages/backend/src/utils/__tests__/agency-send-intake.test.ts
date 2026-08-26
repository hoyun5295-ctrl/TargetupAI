/**
 * 대행발송 접수 코어 계약 (★2026-08-26 §18 승격 · 회의론자 최종 검증 필수 조건 1·5)
 *
 *   ① 리드타임은 코어가 집행한다 — 입구가 늘어도 판정 구현은 validateRequestedAt 한 벌이다.
 *     ★2026-08-26(6) 값은 화면·이메일 모두 40분으로 통일됐고, **미달은 반려가 아니라 자동 조정**이다.
 *   ② 코어는 utils CT 한 벌만 존재한다 — 라우트에 같은 이름의 정의가 되살아나면 빨간불(두 벌 금지).
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { analyzeOneStep, createRequestCore, parseOneStepOverrides } from '../agency-send-intake';
import { EMAIL_MIN_LEAD_MINUTES } from '../agency-send-state';
import { suggestVarColumnsWithAi } from '../ai-column-mapper';

// 확정 경로 AI 0(§18-8 13)을 **행동으로** 검증한다 — 소스 스캔은 조건 반전을 못 잡는다(LESSONS_BACKEND 47행)
vi.mock('../ai-column-mapper', () => ({
  suggestVarColumnsWithAi: vi.fn(async () => [{ name: '이름', column: '고객명' }]),
}));
vi.mock('../callback-filter', () => ({
  getRegisteredCallbackSet: vi.fn(async () => new Set(['0500000000'])),
  isCallbackRegistered: vi.fn(async () => true),
}));

const AUTH = { companyId: '00000000-0000-0000-0000-000000000001', userId: '00000000-0000-0000-0000-000000000002' };

/** DB에 닿기 전에 판정이 끝나도록 사전 조회 컨텍스트를 전부 채운다(등록 발신번호 집합 · 발송 창) */
function pre(minLeadMinutes?: number) {
  return {
    registeredSet: new Set(['0500000000']),
    window: { startHour: 0, endHour: 24 } as { startHour: number | null; endHour: number | null },
    minLeadMinutes,
  };
}

function baseInput(requestedAt: Date) {
  return {
    messageType: 'SMS',
    content: '접수 코어 계약 테스트 문안',
    callbackNumber: '0500000000',
    managerPhones: ['010-0000-1111'],
    requestedAt: requestedAt.toISOString(),
    recipients: [],
  };
}

describe('접수 코어 — 리드타임 집행 지점은 코어 하나다 (§18-8 필수 1)', () => {
  /**
   * ★2026-08-26(6) 촉박한 요청은 거절하지 않고 뒤로 밀어 접수한다(Harold 확정).
   * 시각 게이트를 지났다는 증거 = 그다음 게이트인 수신자 0건 반려에 닿는 것.
   */
  it('리드타임 미달(10분 뒤)도 시각 게이트를 지난다 — 반려가 아니라 조정이다', async () => {
    const at = new Date(Date.now() + 10 * 60000);
    const r = await createRequestCore(AUTH, baseInput(at), undefined, pre());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('보낼 번호가 없습니다');
  });

  it('이미 지난 시각도 안전선까지 끌어올려 접수한다(옛 동작 = 반려)', async () => {
    const at = new Date(Date.now() - 60 * 60000);
    const r = await createRequestCore(AUTH, baseInput(at), undefined, pre());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('보낼 번호가 없습니다');
  });

  it('넉넉한 요청은 그대로 지난다', async () => {
    const at = new Date(Date.now() + 200 * 60000);
    const r = await createRequestCore(AUTH, baseInput(at), undefined, pre());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('보낼 번호가 없습니다');
  });

  it('이메일 값도 화면과 같은 값으로 통일됐다 — 입구가 달라도 같은 판정이다', async () => {
    const at = new Date(Date.now() + 10 * 60000);
    const r = await createRequestCore(AUTH, baseInput(at), undefined, pre(EMAIL_MIN_LEAD_MINUTES));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('보낼 번호가 없습니다');
  });

  /** ⛔ 발송 허용 시간 밖은 여전히 옮기지 않는다 — 조정으로 창을 넘기면 거절이다(하루 뒤로 밀지 않는다) */
  it('조정 결과가 발송 허용 시간을 넘으면 반려한다', async () => {
    const at = new Date(Date.now() + 10 * 60000);
    const narrow = {
      registeredSet: new Set(['0500000000']),
      // 지금 시각과 무관하게 항상 닫힌 창(startHour === endHour = 어떤 시각도 밖)
      window: { startHour: 3, endHour: 3 } as { startHour: number | null; endHour: number | null },
    };
    const r = await createRequestCore(AUTH, baseInput(at), undefined, narrow);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('발송 가능 시간');
  });
});

describe('원스텝 분석 — 확정 경로에서 AI를 부르지 않는다 (§17-6 계약 · §18-8 13 행동 검증)', () => {
  const futureWhen = () => {
    const d = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const formBuf = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['제목', '테스트'],
      ['문안', '%이름%님 안내드립니다.'],
      ['보낼 시각', futureWhen()],
      ['회신번호', '0500000000'],
      ['담당자 번호', '010-0000-1111'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '요청서');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };
  const listBuf = () => {
    const ws = XLSX.utils.aoa_to_sheet([['고객명', '연락처'], ['김하나', '01000001111'], ['이두리', '01000002222']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명단');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };
  const AUTH2 = { companyId: '00000000-0000-0000-0000-000000000001', userId: '00000000-0000-0000-0000-000000000002' };

  it('aiSuggest=false(이메일·확정)는 이름 불일치 항목이 있어도 AI를 부르지 않고 반려 사유를 남긴다', async () => {
    (suggestVarColumnsWithAi as any).mockClear();
    const a = await analyzeOneStep(AUTH2, formBuf(), listBuf(), '명단.xlsx', parseOneStepOverrides({}), false, EMAIL_MIN_LEAD_MINUTES);
    expect(suggestVarColumnsWithAi).not.toHaveBeenCalled();
    expect(a.errors.some((e) => e.field === '문안 항목')).toBe(true);
  });

  it('aiSuggest=true(미리보기 초회)만 AI 추천이 돈다 — 게이트가 뒤집히면 위 테스트가 빨간불이 된다', async () => {
    (suggestVarColumnsWithAi as any).mockClear();
    const a = await analyzeOneStep(AUTH2, formBuf(), listBuf(), '명단.xlsx', parseOneStepOverrides({}), true);
    expect(suggestVarColumnsWithAi).toHaveBeenCalledTimes(1);
    expect(a.varsMatched.find((v) => v.name === '이름')?.via).toBe('ai');
  });
});

describe('접수 코어 — 정의는 CT 한 벌뿐이다 (§18-8 필수 5 · 소스 계약)', () => {
  it('라우트 파일에 createRequestCore·analyzeOneStep 정의가 되살아나면 안 된다', () => {
    const routeSrc = fs.readFileSync(path.resolve(__dirname, '../../routes/agency-send.ts'), 'utf8');
    expect(/async function createRequestCore/.test(routeSrc)).toBe(false);
    expect(/async function analyzeOneStep/.test(routeSrc)).toBe(false);
    expect(routeSrc).toContain("from '../utils/agency-send-intake'");
  });
});
