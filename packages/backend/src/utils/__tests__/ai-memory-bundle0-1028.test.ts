/**
 * AI 메모리 · 브랜드 보이스 묶음 0 (★ 2026-10-28 · 설계서 docs/2026-10-28-ai-memory-brand-voice-design.md §6)
 *
 * K1-1 전송자 명칭 출구 · K1-4 없는 날짜 · K1-7 여정 계절 낱말 · K1-5 법 칸 잔존 0 · K10-1 학습 원천 · K10-2 출처 표식 · K8-4 직접 발송 거름.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const poolQuery = vi.fn(async (..._a: unknown[]) => ({ rows: [] }));
vi.mock('../../config/database', () => ({
  default: { query: (...a: unknown[]) => poolQuery(...a), connect: vi.fn() },
  query: vi.fn(async () => ({ rows: [] })),
  pool: { query: (...a: unknown[]) => poolQuery(...a), connect: vi.fn() },
}));

import { ensureSenderName } from '../messageUtils';
import {
  findInventedDates, replaceInventedDates, DATE_PLACEHOLDER, AI_FILL_DIRECT_PATTERN,
  findSeasonWords, dropSeasonSentences, SEASON_PLACEHOLDER, seasonNote,
} from '../copy-benefit-detector';
import { logTrainingData } from '../training-logger';

const SRC = (...p: string[]) => readFileSync(resolve(process.cwd(), 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const FE = (...p: string[]) => readFileSync(resolve(process.cwd(), '..', 'frontend', 'src', ...p), 'utf8').replace(/\r\n/g, '\n');

describe('K1-1 전송자 명칭(ensureSenderName)', () => {
  const names = ['한줄로', '타깃업'];
  it('광고 아님 · 이름 없음 = 그대로', () => {
    expect(ensureSenderName('본문', { isAd: false, channel: 'LMS', names })).toEqual({ text: '본문', added: false });
    expect(ensureSenderName('본문', { isAd: true, channel: 'LMS', names: [null, '', '  '] })).toEqual({ text: '본문', added: false });
  });
  it('첫 줄 또는 LMS 제목에 이름이 있으면 그대로(공백 무시 · (광고) 머리 건너뜀)', () => {
    expect(ensureSenderName('[한줄 로] 가을 신상\n둘째 줄', { isAd: true, channel: 'LMS', names }).added).toBe(false);
    expect(ensureSenderName('(광고)\n\n[타깃업]\n본문', { isAd: true, channel: 'LMS', names }).added).toBe(false);
    expect(ensureSenderName('본문만', { isAd: true, channel: 'MMS', subject: '한줄로 신상 안내', names }).added).toBe(false);
  });
  it('이름이 끝 줄에만 있으면 첫 줄에 붙인다(LMS = 한 줄 · SMS = 앞 칸)', () => {
    expect(ensureSenderName('본문\n\n[한줄로]', { isAd: true, channel: 'lms', names })).toEqual({ text: '[한줄로]\n본문\n\n[한줄로]', added: true });
    expect(ensureSenderName('오늘만 특가', { isAd: true, channel: 'SMS', names })).toEqual({ text: '[한줄로] 오늘만 특가', added: true });
  });
  it('SMS 는 제목이 있어도 본문을 본다', () => {
    expect(ensureSenderName('오늘만 특가', { isAd: true, channel: 'SMS', subject: '한줄로', names }).added).toBe(true);
  });
  it('빈 본문에는 붙이지 않는다(이름만 남은 무내용 글이 성공으로 지나가지 않게 · Codex 구현 1R)', () => {
    expect(ensureSenderName('', { isAd: true, channel: 'LMS', names })).toEqual({ text: '', added: false });
    expect(ensureSenderName(' \n ', { isAd: true, channel: 'SMS', names }).added).toBe(false);
  });
});

describe('K1-4 없는 날짜 · 기간(발송일 기준)', () => {
  const wed = new Date('2026-10-28T03:00:00Z');   // KST 10/28(수) 12시
  it('근거 글에 없는 날짜 · 기간 = 걸림', () => {
    expect(findInventedDates('10/31까지 20% 할인', '이번 주 신상품 안내', wed)).toEqual(['10/31']);
    expect(findInventedDates('딱 3일간만!', '가을 신상', wed)).toEqual(['3일']);
    expect(findInventedDates('D-3 마감 임박', '', wed)).toEqual(['D-3']);
    expect(findInventedDates('오후 6시까지', '', wed)).toEqual(['오후 6시']);
  });
  it('근거 글의 숫자 · 상대 날짜(오늘 · 내일 · 이번 주말)는 발송일 달력으로 풀려 통과', () => {
    expect(findInventedDates('11월 3일까지', '11월 3일까지 20% 할인', wed)).toEqual([]);
    expect(findInventedDates('10/28(수) 하루만', '오늘만 특가', wed)).toEqual([]);
    expect(findInventedDates('10월 29일 오픈', '내일 오픈', wed)).toEqual([]);
    expect(findInventedDates('10/31~11/1 주말 행사', '이번 주말 행사', wed)).toEqual([]);
  });
  it('기준일이 바뀌면 같은 「오늘」이 다른 날을 허용한다(자동마케팅 회차 발송일)', () => {
    const nov2 = new Date('2026-11-02T03:00:00Z');
    expect(findInventedDates('11/2 하루만', '오늘만', nov2)).toEqual([]);
    expect(findInventedDates('11/2 하루만', '오늘만', wed)).toEqual(['11/2']);
  });
  it('근거 글의 할인율 · 금액 숫자는 날짜 근거가 아니다 · 단위가 다르면 근거가 아니다(Codex 구현 1R)', () => {
    expect(findInventedDates('10일까지 10% 할인', '신상 10% 할인', wed)).toEqual(['10일']);
    expect(findInventedDates('5일간 5,000원 할인', '5,000원 할인', wed)).toEqual(['5일']);
    expect(findInventedDates('오후 10시까지', '10일까지 행사', wed)).toEqual(['오후 10시']);
    // 사람 글의 날짜 말은 꼴이 자유로워도 근거(「12일 오픈」 · 「11.5~7」 · 「5~7일」 · 「3시간」)
    expect(findInventedDates('12일까지 오픈 기념', '12일 오픈', wed)).toEqual([]);
    expect(findInventedDates('11/5~11/7 행사', '11.5~7 행사', wed)).toEqual([]);
    expect(findInventedDates('5일부터 7일까지', '5~7일 행사', wed)).toEqual([]);
    expect(findInventedDates('3시간 한정', '3시간 타임세일', wed)).toEqual([]);
    expect(findInventedDates('11/7 마감', '11월 5일~7일 행사', wed)).toEqual([]);   // 쌍 날짜 = 월 · 일 단위 키 둘 다 있으면 근거
  });
  it('쌍 날짜 숫자는 쌍으로만 근거 · 단위 뒤가 낱말이면 단위가 아니다(Codex 구현 2R)', () => {
    expect(findInventedDates('5일까지 행사', '10.5 % 할인', wed)).toEqual(['5일']);
    expect(findInventedDates('2일까지 적립', '1.5~2배 적립', wed)).toEqual(['2일']);
    expect(findInventedDates('2일까지 반값', '1/2 가격', wed)).toEqual(['2일']);
    expect(findInventedDates('3주간 행사', '창립 3주년 기념전', wed)).toEqual(['3주']);
    expect(findInventedDates('5일간 장터', '5일장 소식', wed)).toEqual(['5일']);
    expect(findInventedDates('3시까지', '3시즌 신상', wed)).toEqual(['3시']);
    // 사람이 쓴 쌍 날짜를 그대로 쓴 것은 근거(같은 숫자 쌍)
    expect(findInventedDates('11/5(수) 오픈', '11.5 오픈', wed)).toEqual([]);
  });
  it('문법 하나 · 위치 토큰(Codex 구현 3R)', () => {
    // 식별자 안의 D-n 은 날짜가 아니다(근거 · 출력 같은 경계)
    expect(findInventedDates('3일간 신상품 행사', 'LED-3 조명 신상품', wed)).toEqual(['3일']);
    expect(findInventedDates('LED-3 조명 입고', '', wed)).toEqual([]);
    // 허용된 쌍 날짜 안의 「5일」을 따로 다시 보지 않는다
    expect(findInventedDates('11월 5일까지 행사', '11/5까지 행사', wed)).toEqual([]);
    // 같은 표현은 양쪽 같은 판정(근거의 「오후 3시쯤」 = 출력의 같은 말의 근거)
    expect(findInventedDates('오후 3시쯤 오픈', '오후 3시쯤 오픈', wed)).toEqual([]);
    expect(findInventedDates('3시로 변경됐어요', '3시로 변경', wed)).toEqual([]);
    // 기간(시간)은 시각 근거가 아니다(Codex 구현 4R)
    expect(findInventedDates('오후 3시부터 운영', '오후 3시간 한정 운영', wed)).toEqual(['오후 3시']);
    expect(findInventedDates('오후 3시간 한정 운영', '오후 3시간 한정 운영', wed)).toEqual([]);
    // 바꾸기 = 그 자리만(같은 글자의 허용된 자리는 그대로)
    expect(replaceInventedDates('11월 5일 오픈 · 5일까지 할인', '11/5 오픈', wed)).toBe(`11월 5일 오픈 · ${DATE_PLACEHOLDER}까지 할인`);
  });
  it('수량 · 금액 숫자는 날짜 꼴이 아니라 보지 않는다 · 변수 자리는 건너뛴다', () => {
    expect(findInventedDates('3개 구매 시 5,000원', '', wed)).toEqual([]);
    expect(findInventedDates('%만료일%까지 사용', '', wed)).toEqual([]);
  });
  it('바꾼 자리 = 직접 채울 칸 규격(발송 길목이 막는다)', () => {
    expect(replaceInventedDates('10/31까지 할인', '', wed)).toBe(`${DATE_PLACEHOLDER}까지 할인`);
    expect(AI_FILL_DIRECT_PATTERN.test(DATE_PLACEHOLDER)).toBe(true);
  });
});

describe('K1-7 여정 계절 낱말', () => {
  it('근거 글에 없는 계절 · 달 이름 = 걸림 · 있으면 통과', () => {
    expect(findSeasonWords('가을 신상이 왔어요', '')).toEqual(['가을']);
    expect(findSeasonWords('가을 신상이 왔어요', '가을 신상 여정')).toEqual([]);
    expect(findSeasonWords('12월 감사 인사', '')).toEqual(['12월']);
    expect(findSeasonWords('봄맞이 준비', '')).toEqual(['봄']);
  });
  it('낱말 속 한 글자(돌봄) · 날짜(M월 D일)는 계절 말이 아니다', () => {
    expect(findSeasonWords('피부 돌봄 루틴', '')).toEqual([]);
    expect(findSeasonWords('12월 25일 마감', '')).toEqual([]);
  });
  it('걸린 문장만 빼고 · 다 빠지면 직접 채울 칸', () => {
    expect(dropSeasonSentences('가을 신상이 왔어요. 지금 확인하세요!', '')).toEqual({ text: '지금 확인하세요!', dropped: ['가을 신상이 왔어요.'] });
    expect(dropSeasonSentences('첫 문단이에요.\n\n연말 감사 인사예요.', '')).toEqual({ text: '첫 문단이에요.', dropped: ['연말 감사 인사예요.'] });
    expect(dropSeasonSentences('추석 인사드려요.', '').text).toBe(SEASON_PLACEHOLDER);
    expect(AI_FILL_DIRECT_PATTERN.test(SEASON_PLACEHOLDER)).toBe(true);
    expect(dropSeasonSentences('평소 문안이에요.', '')).toEqual({ text: '평소 문안이에요.', dropped: [] });
  });
  it('안내 줄 = 바깥 문장 규칙(가운뎃점 · 줄표 없음)', () => {
    expect(seasonNote(2)).toContain('2곳');
    expect(seasonNote(2)).not.toMatch(/[·—–]/);
  });
  it('여정 생산자 출구 일곱 곳이 계절 검사를 지난다', () => {
    const gen = SRC('utils', 'journey-ai-generator.ts');
    expect(gen.match(/findSeasonWords\(|dropSeasonSentences\(/g)!.length).toBeGreaterThanOrEqual(6);   // 패키지(다시 쓰기 · 단계) · 다듬기 · 기준일 · 스팸 재작성
    expect(SRC('utils', 'journey-builder.ts')).toContain('dropSeasonSentences(');
    expect(SRC('utils', 'journey-step-diagnosis.ts')).toContain('dropSeasonSentences(');
    expect(SRC('utils', 'journey-ai-editor.ts')).toContain('findSeasonWords(');
  });
});

describe('K1-1 · K1-3 문자 · 여정 생산자 출구 배선', () => {
  it('generateMessages = 전송자 명칭 · 날짜 출구(출구 CT · 묶음 A K12-1) · 단문 바이트에서 이름 몫을 뺀다', () => {
    const ai = SRC('services', 'ai.ts');
    const exit = SRC('utils', 'copy-exit-guards.ts');
    expect(ai).toContain('const out = applyCopyExitGuards(variant as any, exitCtx);');
    expect(exit).toContain('ensureSenderName(');
    expect(exit).toContain('findInventedDates(');
    expect(ai).toMatch(/getAvailableSmsBytes\(isAd, rejectNumber, senderBytes\)/);
  });
  it('집 규칙 = 전송자 명칭 첫 줄(끝 줄 지시 잔존 0)', () => {
    const ai = SRC('services', 'ai.ts');
    expect(ai).not.toMatch(/\[브랜드명\]이 본문의 마지막 줄/);
    expect(ai).toContain('전송자 명칭 = 본문 첫 줄 [브랜드명]');
  });
  it('여정 생산자 = 광고 문자 단계에 전송자 명칭', () => {
    for (const f of ['journey-ai-generator.ts', 'journey-builder.ts', 'journey-step-diagnosis.ts', 'journey-ai-editor.ts']) {
      expect(SRC('utils', f)).toContain('ensureSenderName(');
    }
  });
  it('자동마케팅 = 회차 발송일을 기준일로 넘긴다(본 생성 · 다시 생성)', () => {
    expect(SRC('utils', 'auto-campaign-worker.ts').match(/baseDate: new Date\(ac\.next_run_at\)/g)!.length).toBe(2);
  });
});

describe('K1-5 법 칸(광고 · 080 위치) 잔존 0', () => {
  it('추출 · 정정 · 목소리 지시 · 검증기 · 변경 문장 · 화면 어디에도 없다', () => {
    const files = [
      SRC('routes', 'ai-memory.ts'), SRC('utils', 'brand-voice-prompt.ts'), SRC('utils', 'brand-voice-validator.ts'),
      SRC('utils', 'ai-memory-text.ts'), FE('components', 'AiMemory', 'BrandVoiceCard.tsx'),
    ];
    for (const s of files) {
      const code = s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code).not.toMatch(/ad_prefix_position|reject_position/);
    }
  });
  it('화면 = 잠긴 한 줄', () => {
    expect(FE('components', 'AiMemory', 'BrandVoiceCard.tsx')).toContain('법이 정한 것: (광고) 맨 앞 · 080 맨 끝 · 바이트 한도 · 이모지 불가');
  });
});

describe('K10-2 학습 원장 출처 표식(model_params.authorship)', () => {
  beforeEach(() => { poolQuery.mockClear(); });
  const base = { campaignRunId: 'c1', companyId: 'co', messageType: 'LMS' as const, isAd: true, finalMessage: '본문', finalSource: 'manual' as const };
  const authorship = () => JSON.parse(String((poolQuery.mock.calls.at(-1)![1] as unknown[])[20])).authorship;
  it('표식 없음 = path_manual · 경로가 넘기면 그 값', async () => {
    await logTrainingData(base);
    expect(authorship()).toBe('path_manual');
    await logTrainingData({ ...base, authorship: 'path_ai' });
    expect(authorship()).toBe('path_ai');
  });
  it('허브 기록이 있으면 편집 여부가 진실(경로 값보다 먼저)', async () => {
    const raw = { messages: ['A', 'B', 'C'], names: ['가', '나', '다'], selectedIndex: 0, recommendedIndex: 0, edited: false };
    await logTrainingData({ ...base, authorship: 'path_ai', aiVariantsRaw: raw });
    expect(authorship()).toBe('hub_as_is');
    await logTrainingData({ ...base, aiVariantsRaw: { ...raw, edited: true } });
    expect(authorship()).toBe('hub_edited');
  });
  it('AI 경로 = path_ai(AI 캠페인 · 여정 · 플래너 · 운영자 · AI 생성 이메일)', () => {
    expect(SRC('routes', 'campaigns.ts')).toContain("authorship: 'path_ai',");
    expect(SRC('utils', 'journey-executor.ts')).toContain("authorship: 'path_ai',");
    expect(SRC('utils', 'planner-executor.ts')).toContain("authorship: 'path_ai' }");
    expect(SRC('utils', 'continuous-operator.ts')).toContain("authorship: 'path_ai' }");
    expect(SRC('utils', 'email-channel.ts')).toContain("authorship: campaign.aiGenerated ? 'path_ai' : 'path_manual',");
    expect(SRC('utils', 'direct-send-core.ts')).toContain('authorship: training?.authorship,');
  });
});

describe('K10-1 학습 원천 = 템플릿 원문(고객 렌더본 금지)', () => {
  it('여정 = 단계 템플릿(알림톡 = 승인 템플릿 · 문자 = Liquid 평문화)', () => {
    const ex = SRC('utils', 'journey-executor.ts');
    expect(ex).toContain("const trainingText = isKakao && kakaoTemplateRow ? String(kakaoTemplateRow.content || '') : flattenLiquidToPlainText(step.message_template || '');");
    expect(ex).toContain('finalMessage: trainingText,');
    expect(ex).not.toMatch(/logCampaignTraining\(\{[^}]*finalMessage: message,/);
  });
  it('알림톡 큐 = 같은 회사 · 템플릿 코드의 원문 · 못 읽으면 적재 0', () => {
    const q = SRC('utils', 'sms-queue.ts');
    expect(q).toContain('SELECT content FROM kakao_templates WHERE company_id = $1 AND template_code = $2 LIMIT 1');
    expect(q).toContain('finalMessage: tplText,');
    expect(q).not.toContain('finalMessage: first.message,');
  });
});

describe('K8-4 회사 예시 조회 = 사람이 보낸 직접 발송만', () => {
  it('최근 발송 문안 세 벌 = 「사람이 보낸 발송」 CT 하나(묶음 A · 직접 발송 − 허브 3안 그대로)', () => {
    expect(SRC('routes', 'ai.ts').match(/listRecentHumanSentTexts\(companyId, \{ days: 30, limit: 10 \}\)/g)!.length).toBe(2);
    expect(SRC('services', 'ai-orchestrator.ts')).toContain('listRecentHumanSentTexts(companyId, { days: 30, limit: 10 })');
    expect(SRC('utils', 'human-sent-messages.ts')).toContain("AND c.send_type = 'direct'");
    for (const f of [SRC('routes', 'ai.ts'), SRC('services', 'ai-orchestrator.ts')]) expect(f).not.toMatch(/SELECT (DISTINCT )?message_content( as content| AS content)?\s+FROM campaigns/);
  });
});
