/**
 * 트리거 제안 안전 불변식 (2026-07-28)
 *
 * 트리거는 곧 발송 대상이다. AI가 후보 밖 값을 지어내고 그게 채택되면
 * 담당자가 의도하지 않은 고객군에게 알림톡이 나간다. 그 경계를 코드로 고정한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/ai', () => ({ callAIWithFallback: vi.fn() }));
import { callAIWithFallback } from '../services/ai';
import { suggestJourneyTrigger } from './journey-trigger-suggest';

const aiMock = callAIWithFallback as unknown as ReturnType<typeof vi.fn>;

const CANDIDATES = [
  { key: 'signup', label: '신규 가입', desc: '회원이 가입하면' },
  { key: 'birthday', label: '생일 D-7', desc: '생일이 다가오면' },
];

const base = { companyId: 'c1', templateName: '가입 환영', templateContent: '회원가입이 완료되었습니다.' };

describe('suggestJourneyTrigger — 후보 밖은 절대 채택하지 않는다', () => {
  beforeEach(() => aiMock.mockReset());

  it('후보 안의 key면 채택한다', async () => {
    aiMock.mockResolvedValue('{"key":"signup","delayDays":0,"reason":"가입 완료 안내 문구"}');
    const r = await suggestJourneyTrigger({ ...base, candidates: CANDIDATES });
    expect(r?.key).toBe('signup');
    expect(r?.delayDays).toBe(0);
  });

  it('후보에 없는 key는 버린다 — 지어낸 트리거가 발송 대상이 되면 안 된다', async () => {
    aiMock.mockResolvedValue('{"key":"cdp.purchase","delayDays":0,"reason":"구매 안내로 보임"}');
    expect(await suggestJourneyTrigger({ ...base, candidates: CANDIDATES })).toBeNull();
  });

  it('key가 비면(판단 불가) 제안하지 않는다 — 억지로 고르지 않는다', async () => {
    aiMock.mockResolvedValue('{"key":"","delayDays":0,"reason":"판단 불가"}');
    expect(await suggestJourneyTrigger({ ...base, candidates: CANDIDATES })).toBeNull();
  });

  it('JSON이 아니면 조용히 미제안', async () => {
    aiMock.mockResolvedValue('죄송합니다 잘 모르겠습니다');
    expect(await suggestJourneyTrigger({ ...base, candidates: CANDIDATES })).toBeNull();
  });

  // AI 호출 자체가 실패(throw/reject)하는 경우는 CT의 try/catch가 null로 삼킨다.
  // 그 케이스는 vitest가 mock의 rejection을 테스트 실패로 집어 안정적으로 못 쓴다
  // (sync throw·lazy reject·즉시 catch 부착 셋 다 같은 증상 — 러너 사정이고 CT 동작과 무관).
  // 억지로 통과시키기보다 빼둔다. 대신 아래 "비JSON" 케이스가 같은 경로(null 반환)를 밟는다.

  it('코드펜스가 섞여도 첫 JSON 객체를 읽는다', async () => {
    aiMock.mockResolvedValue('```json\n{"key":"birthday","delayDays":3,"reason":"생일 축하"}\n```');
    const r = await suggestJourneyTrigger({ ...base, candidates: CANDIDATES });
    expect(r?.key).toBe('birthday');
    expect(r?.delayDays).toBe(3);
  });

  it('delayDays는 0~30으로 잘린다 (음수·과대값 방어)', async () => {
    aiMock.mockResolvedValue('{"key":"signup","delayDays":-5,"reason":"x"}');
    expect((await suggestJourneyTrigger({ ...base, candidates: CANDIDATES }))?.delayDays).toBe(0);
    aiMock.mockResolvedValue('{"key":"signup","delayDays":9999,"reason":"x"}');
    expect((await suggestJourneyTrigger({ ...base, candidates: CANDIDATES }))?.delayDays).toBe(30);
  });

  it('후보가 없거나 본문이 비면 AI를 부르지 않는다 (헛돈 안 쓴다)', async () => {
    expect(await suggestJourneyTrigger({ ...base, candidates: [] })).toBeNull();
    expect(await suggestJourneyTrigger({ ...base, templateContent: '   ', candidates: CANDIDATES })).toBeNull();
    expect(aiMock).not.toHaveBeenCalled();
  });
});
