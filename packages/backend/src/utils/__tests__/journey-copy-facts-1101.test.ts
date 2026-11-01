/**
 * 여정 사람 값 원장(journeys.copy_facts) · 근거 규칙 한 곳 — 여정 재발 방지 설계 B1-2 · B1-3(★2026-11-01)
 *
 * 1101 Harold 「혜택을 넣었는데도 칸마다 직접 넣으라고 나온다 · 마지막엔 10% 할인쿠폰 · 위엔 직접입력해주세요」
 *   원인 = 사람이 정한 혜택 · 링크가 여정에 남지 않아 칸마다 다른 근거로 문안을 만들었다.
 * 못 박는 것
 *   1. 원장 읽기 · 상태(안 정함 · 없음 · 정함) · 근거 규칙(쓰기 · 고치기) · 저장 조각(못 쓰는 링크 거절).
 *   2. 혜택 자리표시 채우기 = 시스템이 심는 표기만(정상 안내문 0).
 *   3. 배선: 여정 생산자(다듬기 · 보내기 전 재작성 · 다음 칸 · 편집)가 근거 함수 하나를 지난다 · 채우기 주소 · 화면이 채우기 함수를 넘긴다 ·
 *      여정 행 복제(새 판)가 원장을 옮긴다 · 생성 길(질문표)이 원장에 쓴다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseCopyFacts, journeyCopyFacts, journeyCopyGround, buildCopyFactsPatch, fillBenefitSpots, hasBenefitSpot,
} from '../journey-copy-facts';
import { BENEFIT_PLACEHOLDER } from '../copy-benefit-detector';
import { fillLinkSpots, ensureOnceLink, stripOmittedLinks } from '../voice-form-slots';

const BE = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

describe('원장 읽기 · 상태 · 근거 규칙', () => {
  it('못 읽는 칸 = 안 정함 · [] = 혜택 없음 · 정함 = 글 · 링크 = 정함 · 뺌 · 못 쓰는 주소 = 안 정함', () => {
    expect(journeyCopyFacts(parseCopyFacts(null))).toEqual({ benefit: { state: 'unset', ground: '' }, link: { state: 'unset', url: null } });
    expect(journeyCopyFacts(parseCopyFacts({ benefits: [] })).benefit.state).toBe('none');
    const set = parseCopyFacts({ benefits: [{ text: '첫 구매 10% 할인쿠폰', by: 'question', at: 'x' }], link: { url: 'https://hanjul.ai/e', by: 'fill', at: 'x' } });
    expect(journeyCopyFacts(set)).toEqual({ benefit: { state: 'set', ground: '첫 구매 10% 할인쿠폰' }, link: { state: 'set', url: 'https://hanjul.ai/e' } });
    expect(journeyCopyFacts(parseCopyFacts({ link: { omit: true } })).link.state).toBe('omit');
    expect(journeyCopyFacts(parseCopyFacts({ link: { url: 'http://localhost/x' } })).link.state).toBe('unset');
  });
  it('쓰기 = 정함 → 원장 · 없음 → 빈 글 · 안 정함 → 옛 근거 / 고치기 = 위 + 지금 본문', () => {
    const set = parseCopyFacts({ benefits: [{ text: '첫 구매 10% 할인쿠폰' }] });
    expect(journeyCopyGround(set, 'write', '목표문 20% 쿠폰')).toBe('첫 구매 10% 할인쿠폰');
    expect(journeyCopyGround(parseCopyFacts({ benefits: [] }), 'write', '목표문 20% 쿠폰')).toBe('');
    expect(journeyCopyGround(null, 'write', '앞 칸 10% 할인')).toBe('앞 칸 10% 할인');
    expect(journeyCopyGround(set, 'fix', '', '지금 본문 5천원 적립')).toBe('첫 구매 10% 할인쿠폰\n지금 본문 5천원 적립');
    expect(journeyCopyGround(null, 'fix', '', '지금 본문')).toBe('지금 본문');
  });
  it('저장 조각 = 혜택 · 링크 따로 · 최대 5 · 200자 · 못 쓰는 링크 = 거절 · 뺌', () => {
    const p = buildCopyFactsPatch({ benefits: ['  10% 쿠폰 ', '', 'x'.repeat(300)] }, 'fill', 'T');
    expect(p.benefits).toEqual([{ text: '10% 쿠폰', by: 'fill', at: 'T' }, { text: 'x'.repeat(200), by: 'fill', at: 'T' }]);
    expect(p.link).toBeUndefined();
    expect(buildCopyFactsPatch({ link: 'ftp://x' }, 'fill').error).toBeTruthy();
    expect(buildCopyFactsPatch({ link: 'omit' }, 'fill', 'T').link).toEqual({ omit: true, by: 'fill', at: 'T' });
  });
});

describe('자리표시 채우기 = 시스템이 심는 표기만', () => {
  it('혜택 자리표시 → 값 · 정상 안내문은 그대로', () => {
    expect(fillBenefitSpots(`지금 ${BENEFIT_PLACEHOLDER} 드려요`, '10% 할인쿠폰')).toBe('지금 10% 할인쿠폰 드려요');
    expect(fillBenefitSpots('[혜택은 앱에서 직접 확인하세요]', '10% 할인쿠폰')).toBe('[혜택은 앱에서 직접 확인하세요]');
    expect(hasBenefitSpot(`${BENEFIT_PLACEHOLDER}`)).toBe(true);
    expect(fillBenefitSpots('가격 $1 ' + BENEFIT_PLACEHOLDER, '$& 특가')).toBe('가격 $1 $& 특가');
  });
  it('링크 넣기 = 자리표시만 바꾸고 붙이지 않는다(ensureOnceLink 는 그대로 붙인다)', () => {
    expect(fillLinkSpots('자세히 → [URL 입력]', 'https://hanjul.ai/e')).toEqual({ text: '자세히 → https://hanjul.ai/e', hit: true });
    expect(fillLinkSpots('링크 없는 칸', 'https://hanjul.ai/e')).toEqual({ text: '링크 없는 칸', hit: false });
    expect(ensureOnceLink('링크 없는 칸', 'https://hanjul.ai/e').appended).toBe(true);
  });
});

describe('배선(계약)', () => {
  const gen = read(BE, 'utils/journey-ai-generator.ts');
  it('여정 생산자가 근거 함수 하나(journeyCopyGround)를 지난다 — 다듬기 · 보내기 전 재작성 · 다음 칸 · 편집', () => {
    expect(gen).toMatch(/const benefitGround = journeyCopyGround\(input\.copyFacts, hasBody \? 'fix' : 'write'/);
    expect(gen).toMatch(/replaceInventedBenefits\(stripAdParts\(san\.sanitized\), benefitGround\)/);
    expect(gen).toMatch(/const regenGround = journeyCopyGround\(input\.copyFacts, 'fix', '', input\.currentMessage\)/);
    expect(gen).toMatch(/findInventedBenefits\(out, regenGround\)/);
    expect(read(BE, 'utils/journey-step-diagnosis.ts')).toMatch(/const recGround = journeyCopyGround\(recFacts, 'write'/);
    expect(read(BE, 'utils/journey-ai-editor.ts')).toMatch(/const editBasis = journeyCopyGround\(/);
    expect(read(BE, 'utils/journey-pretest-notifier.ts')).toMatch(/copyFacts: await readJourneyCopyFacts\(b\.companyId, b\.journeyId\)/);
  });
  it('혜택이 정해진 생성 = 지시문의 혜택 자리표시를 그 혜택으로 · 남은 자리표시는 그 혜택으로 채움', () => {
    expect(gen).toMatch(/system = system\.split\(BENEFIT_PLACEHOLDER\)\.join\(benefitText\);/);
    expect(gen).toMatch(/const benefitFilled = !!benefitText && hasBenefitSpot\(season\.text\);/);
  });
  it('채우기 주소 = 원장 + 전 칸(한 트랜잭션 · 칸 갱신 몸통 그대로) · 화면이 채우기 함수를 넘긴다', () => {
    const builder = read(BE, 'utils/journey-builder.ts');
    expect(builder).toMatch(/export async function fillJourneyCopyFacts\(/);
    expect(builder).toMatch(/return withJourneyValidationReset\(companyId, journeyId, async \(run, journey\) => \{\s*await writeJourneyCopyFacts\(run, journeyId/);
    expect(builder).toMatch(/await applyStepPatchInLock\(run, journey, companyId, journeyId, row\.id, \{/);
    expect(builder).toMatch(/withJourneyValidationReset\(companyId, journeyId, \(run, journey\) => applyStepPatchInLock\(run, journey, companyId, journeyId, stepId, patch\)/);
    expect(read(BE, 'routes/ai.ts')).toMatch(/router\.post\('\/operator\/journeys\/:id\/copy-facts'/);
    const ws = read(FE, 'components/journey/workspace/JourneyWorkspace.tsx');
    expect(ws).toMatch(/onFillBenefit=\{journeyId && !selected\.startsWith\(NEW_STEP_PREFIX\) \? \(b\) => void fillFacts\(\{ benefit: b \}\)/);
    expect(ws).toMatch(/onFillUrl=\{journeyId && !selected\.startsWith\(NEW_STEP_PREFIX\) \? \(u\) => void fillFacts\(\{ url: u \}\)/);
    expect(ws).toMatch(/journeyId: journeyId \|\| undefined,\s*message: cur\.messageTemplate/);
  });
  it('생성 길(질문표) = 원장에 쓴다 · 여정 행 INSERT 는 원장을 옮기거나(새 판 = 행 통째) 생성 뒤 따로 쓴다', () => {
    const builder = read(BE, 'utils/journey-builder.ts');
    // ★ Codex 구현 1R B #3 · #4 — 세 갈래 그대로(혜택 없음 [] · 링크 뺌 'omit' 도 정한 값) · 혜택 · 링크 따로(링크를 못 읽어도 혜택은 남김)
    expect(builder).toMatch(/if \(input\.copyFacts && \(input\.copyFacts\.benefits !== null \|\| input\.copyFacts\.link !== null\) && \(await copyFactsColumnReady\(\)\)\)/);
    expect(builder).toContain('await writeJourneyCopyFacts((t, pr) => query(t, pr), journeyId, { benefits: pb.benefits, link: pl.error ? undefined : pl.link });');
    expect(read(BE, 'utils/journey-draft-save.ts')).toContain('copyFacts: pkg.decidedFacts,');
    expect(read(FE, 'pages/JourneysPage.tsx')).toContain('if (aiPkg.decidedFacts) body.copyFacts = aiPkg.decidedFacts;');
    expect(gen).toMatch(/benefits: benefitText \? \[benefitText\] : input\.benefitText === null \? \[\] : null,/);
    expect(gen).toMatch(/link: onceLink \? onceLink : input\.voiceForm\?\.link && 'omit' in input\.voiceForm\.link \? 'omit' : null,/);
    const lineage = read(BE, 'utils/journey-lineage.ts');
    expect(lineage).toMatch(/INSERT INTO journeys SELECT \(jsonb_populate_record\(NULL::journeys, to_jsonb\(j\) \|\| \$2::jsonb\)\)\.\* FROM journeys j/);
    expect(lineage).not.toMatch(/RESET_NULL = \[[^\]]*'copy_facts'/);
  });
});

// ★ 2026-11-01 Codex 구현 1R(B #3 · #5 · #6)
describe('원장 링크 = 질문표와 같은 판정 · 다음 칸 추천 = 원장 반영 · 채우기 잠금', () => {
  it('https:// 없는 도메인 꼴도 원장에 그대로(적은 그대로) · 사설 · 숫자 주소는 거절', () => {
    expect(buildCopyFactsPatch({ link: 'shop.example.com/event' }, 'question', 'T').link).toEqual({ url: 'shop.example.com/event', by: 'question', at: 'T' });
    expect(journeyCopyFacts(parseCopyFacts({ link: { url: 'shop.example.com/event' } })).link).toEqual({ state: 'set', url: 'shop.example.com/event' });
    expect(buildCopyFactsPatch({ link: 'http://192.168.0.1/x' }, 'fill').error).toBeTruthy();
    expect(buildCopyFactsPatch({ link: 'localhost' }, 'fill').error).toBeTruthy();
  });
  it('다음 칸 추천 = AI 호출 전에 원장을 읽어 지시문에 · 결과에 혜택 채움 · 링크 넣기 · 뺀 링크 지움', () => {
    const d = read(BE, 'utils/journey-step-diagnosis.ts');
    const at = d.indexOf('const recFacts = await readJourneyCopyFacts(companyId, journeyId)');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(d.indexOf('const userMessage = `## 회사 정보'));
    expect(d).toContain('- messageTemplate: ${benefitRule}${linkRule}');
    expect(d).toMatch(/if \(factsView\.benefit\.state === 'set' && hasBenefitSpot\(body\)\) body = fillBenefitSpots\(/);
    expect(d).toMatch(/if \(factsView\.link\.state === 'set' && factsView\.link\.url\) body = ensureOnceLink\(body, factsView\.link\.url\)\.text;\s*else if \(factsView\.link\.state === 'omit'\) body = stripOmittedLinks\(body\);/);
    expect(read(BE, 'utils/journey-ai-generator.ts')).toContain("else if (facts.link.state === 'omit') pure = stripOmittedLinks(pure, input.currentMessage || '');");
  });
  it('링크 뺌 = 토큰 · 자리표시 줄 + 실제 주소 줄도 지움(고치기 = 본문에 있던 주소는 둔다) · 라우트 혜택 배열 형식 오류 = 안 정함', () => {
    expect(stripOmittedLinks('안내 문장\nhttps://shop.example.com/event\n감사합니다')).toBe('안내 문장\n감사합니다');
    expect(stripOmittedLinks('안내\n자세히 → [URL 입력]')).toBe('안내');
    // ★ Codex 구현 3R B #3 — 점 있는 낱말(Node.js)은 주소가 아니다 · 경로 있는 도메인 꼴은 주소
    expect(stripOmittedLinks('참여 가능한 강좌는 Node.js 입니다.\n일정을 확인해 주세요.')).toBe('참여 가능한 강좌는 Node.js 입니다.\n일정을 확인해 주세요.');
    expect(stripOmittedLinks('안내\nshop.example.com/event 에서 확인')).toBe('안내');
    expect(stripOmittedLinks('안내\nhttps://a.example.com/x\nhttps://b.example.com/y', '원문 https://a.example.com/x')).toBe('안내\nhttps://a.example.com/x');
    const r = read(BE, 'routes/ai.ts');
    expect(r).toMatch(/benefits: Array\.isArray\(copyFacts\.benefits\) && copyFacts\.benefits\.every\(\(t: unknown\) => typeof t === 'string' && t\.trim\(\) !== ''\)\s*\? copyFacts\.benefits\.slice\(0, 5\) : null,/);
  });
  it('채우기 중 = 칸 편집 · 저장 · 다음 칸 추천 잠금 · 응답 때 같은 여정인지 확인', () => {
    const ws = read(FE, 'components/journey/workspace/JourneyWorkspace.tsx');
    expect(ws).toContain('<fieldset disabled={filling} aria-busy={filling}');
    expect(ws).toContain('if (jid !== journeyIdRef.current) return;');
    expect(ws).toMatch(/\} finally \{\s*setFilling\(false\);\s*\}/);
    expect(ws).toContain('disabled={saving || filling || locked || !ready}');
    // ★ Codex 구현 2R B #5 — 공통 편집 잠금에 채우기 · 채우면 추천 세대를 올려 옛 원장 추천 · 진행 중 응답을 버린다
    expect(ws).toContain('editLockRef.current = saving || reshaping || detaching || filling;');
    expect(ws).toMatch(/setFilling\(true\);\s*recGenRef\.current \+= 1;\s*setNextRec\(\{ loading: false, data: null \}\);/);
    expect(ws).toContain('const mine = () => gen === recGenRef.current && jid === journeyIdRef.current;');
    expect(ws).toContain('if (mine()) setNextRec({ loading: false, data: d.recommendation || null });');
    expect(ws).toContain('setVariantsOpen(null); recGenRef.current += 1; setNextRec({ loading: false, data: null });');   // 여정이 바뀌면 세대도 오른다
  });
});
