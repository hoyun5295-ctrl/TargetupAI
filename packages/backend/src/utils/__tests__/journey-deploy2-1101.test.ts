/**
 * 여정 재발 방지 배포 2(★ 2026-11-01 · docs/2026-11-01-journey-recurrence-prevention-design.md §3) 계약 시험
 *
 * C4 자리표시 판정 한 벌 — 여정 켜기 · 보내기 전 검사 · 자동마케팅 출구가 같은 판정을 부른다(J13).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sourceFiles, stripComments } from './helpers/producer-scan';
import { hasUneditedJourneyPlaceholder, hasUneditedBenefitPlaceholder } from '../send-placeholder-gate';
import { hasUneditedPlaceholder } from '../journey-builder';
import { hasUneditedBenefitPlaceholder as autosendBenefit } from '../autosend-policy';
import { itemOfFailure, checkVerdictOf, type JourneyCheckItem } from '../journey-check';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => stripComments(readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n'));
const files = sourceFiles(SRC, /\.ts$/);

describe('C4 자리표시 판정 한 벌', () => {
  it('여정 자리 판정 = 켜기 기준 그대로(정상 대괄호는 통과)', () => {
    expect(hasUneditedJourneyPlaceholder('첫 구매 [혜택 안내: 직접 수정해주세요]')).toBe(true);
    expect(hasUneditedJourneyPlaceholder('자세히 → [URL 입력]')).toBe(true);
    expect(hasUneditedJourneyPlaceholder('[직접 작성해주세요]')).toBe(true);
    expect(hasUneditedJourneyPlaceholder('[송파가락점] 오픈 안내')).toBe(false);
    expect(hasUneditedJourneyPlaceholder('')).toBe(false);
    expect(hasUneditedPlaceholder('')).toBe(true);   // 켜기 관문은 빈 글을 미완성으로 본다(길이 판정 앞)
    expect(hasUneditedPlaceholder('[송파가락점] 오픈 안내')).toBe(false);
  });

  it('보내기 전 검사가 켜기와 같은 자리를 잡는다(옛: 「[직접 작성해주세요]」 · 「[URL…]」만)', () => {
    const src = read('utils/journey-pretest-validator.ts');
    expect(src).toMatch(/hasUneditedJourneyPlaceholder\(msg\.body\)/);
    expect(src).not.toMatch(/function\s+hasUneditedPlaceholder/);
  });

  it('자동마케팅 출구 = 같은 파일의 판정(다시 내보내기 · 기준 그대로)', () => {
    expect(autosendBenefit).toBe(hasUneditedBenefitPlaceholder);
    expect(autosendBenefit('[혜택] 30% 할인')).toBe(true);
    expect(autosendBenefit('오늘 30% 할인')).toBe(false);
  });

  it('여정 자리 정규식은 주인 파일 하나(이메일 · DM 은 email-ai 판정)', () => {
    const owners = files.filter((f) => /\(직접\|작성해\|수정해\|입력해\|URL\)/.test(read(f)));
    expect(owners).toEqual(['utils/send-placeholder-gate.ts']);
    // 혜택 자리 「남았나」 판정의 정의 = 주인 하나(operator-final-copy 의 같은 꼴 정규식은 치환 대상 확인 · applyBenefitToBody 짝이라 판정 아님)
    const defs = files.filter((f) => /function\s+hasUnedited(Benefit|Journey)?Placeholder\b/.test(read(f)));
    expect(defs.sort()).toEqual(['utils/email-ai.ts', 'utils/journey-builder.ts', 'utils/send-placeholder-gate.ts']);
    expect(read('utils/journey-builder.ts')).toMatch(/return hasUneditedJourneyPlaceholder\(message\)/);
  });
});

describe('C5 점검 응답 = 켜기와 같은 판정 · 5어', () => {
  const f = (reason: any, variantId: string | null = null) => ({ stepId: 's1', variantId, reason, details: '통신사 차단: KT' });

  it('실패 줄 → 고칠 곳이 있는 항목', () => {
    expect(itemOfFailure(f('placeholder_unedited'), []).fixTarget).toBe('body');
    expect(itemOfFailure(f('subject_missing'), []).fixTarget).toBe('subject');
    expect(itemOfFailure(f('variable_mapping_invalid'), []).fixTarget).toBe('alimtalk');
    expect(itemOfFailure(f('spam_filter_failed'), [])).toMatchObject({ level: 'fix', fixTarget: 'spam', detail: '통신사 차단: KT' });
    expect(itemOfFailure(f('spam_check_unavailable'), []).level).toBe('before');
  });

  it('검사 중 · 확인 중은 판 상태로 가른다(A/B 판은 판 id 로)', () => {
    expect(itemOfFailure(f('spam_check_pending'), [{ stepId: 's1', variantId: null, state: 'pending' }]).level).toBe('running');
    expect(itemOfFailure(f('spam_check_pending', 'v2'), [{ stepId: 's1', variantId: null, state: 'pending' }, { stepId: 's1', variantId: 'v2', state: 'unconfirmed' }]).level).toBe('confirming');
  });

  it('판정 문장 = 고칠 것 · 확인 중이 있으면 못 켬 · 검사 전만 있으면 켤 수 있음', () => {
    const it_ = (level: JourneyCheckItem['level']): JourneyCheckItem => ({ key: level, level, title: '', detail: '', fixTarget: null, variantId: null });
    expect(checkVerdictOf([it_('pass')])).toMatchObject({ canActivate: true, sentence: '켤 수 있어요' });
    expect(checkVerdictOf([it_('before'), it_('pass')])).toMatchObject({ canActivate: true, sentence: '켤 수 있어요 · 켤 때 스팸 검사 1개' });
    expect(checkVerdictOf([it_('fix'), it_('confirming'), it_('running')])).toMatchObject({ canActivate: false, sentence: '아직 못 켜요 · 고칠 것 1 · 확인 중 2' });
    expect(checkVerdictOf([it_('running')]).sentence).toBe('아직 못 켜요 · 확인 중 1');
  });

  it('판정 두 벌 0 — 켜기 · 점검이 같은 함수를 부른다', () => {
    const builder = read('utils/journey-builder.ts');
    expect(builder).toMatch(/export async function activationBlockReason\(/);
    expect(builder).toMatch(/const blocked = await activationBlockReason\(companyId, journeyId\);/);
    const check = read('utils/journey-check.ts');
    expect(check).toMatch(/activationBlockReason\(companyId, journeyId, \{ forCheck: true \}\)/);
    expect(check).toMatch(/validateJourneyForActivation\(companyId, journeyId, userId, \{ spam: peekStepSpam, spamStates: states \}\)/);
    // 점검 응답은 검사를 등록하지 않는다(엿보기만) · 등록 함수 이름이 점검 함수 몸통에 없다
    const body = check.slice(check.indexOf('export async function checkJourney'), check.indexOf('export async function startJourneyStepSpamChecks'));
    expect(body).not.toMatch(/enqueueSpamTest|startStepSpamCheck|runStepSpamTest/);
  });

  it('엿보기 · 칸 저장 뒤 검사 = 등록과 같은 글 · 같은 키(같은 날 같은 글 = 이어 보기)', () => {
    const v = read('utils/journey-pretest-validator.ts');
    expect(v).toMatch(/peekSpamCheck\(await stepSpamInput\(params\)\)/);
    expect(v).toMatch(/enqueueSpamTest\(\{ \.\.\.\(await stepSpamInput\(params\)\), source: 'auto_ai', [^}]*reuseSameDay: true \}\)/);
    const q = read('utils/spam-test-queue.ts');
    expect(q).toMatch(/const \{ key \} = await spamHashInputsOf\(params\);/);
    expect(q).toMatch(/const hashed = await spamHashInputsOf\(params\);/);
  });

  it('주소 = 칸 저장 · 칸 더하기 · 혜택 넣기 뒤 자동 검사 · 점검 응답', () => {
    const r = read('routes/ai.ts');
    expect(r).toMatch(/router\.get\('\/operator\/journeys\/:id\/check'/);
    expect((r.match(/startJourneyStepSpamChecks\(/g) || []).length).toBe(3);
  });
});

describe('C2 출구 한 곳 · 검사된 글 표식', () => {
  it('`as CheckedCopy` 는 출구 파일 밖 0', () => {
    const outside = files.filter((f) => f !== 'utils/copy-finish.ts' && /as\s+CheckedCopy\b/.test(read(f)));
    expect(outside).toEqual([]);
  });

  // 여정 AI 생산자 = 소스에서 뽑는다(AI 를 부르는 journey-*.ts · variant-generator.ts) · 손 표에 없는 새 생산자 = 실패
  const PRODUCERS: Record<string, { where: 'self' | 'route' | 'none'; note: string }> = {
    'utils/journey-ai-generator.ts': { where: 'self', note: '패키지 = 자기 출구 · 다듬기 · 날짜축 계획 = 주소 출구 · 스팸 재작성 = 보내기 전 검사 출구' },
    'utils/journey-ai-editor.ts': { where: 'route', note: 'AI 수정 = journeys-ai-edit 주소 출구' },
    'utils/journey-builder.ts': { where: 'self', note: '목표문 직접 생성 칸 = 저장 전 출구' },
    'utils/journey-step-diagnosis.ts': { where: 'self', note: '다음 칸 추천 = 자기 출구' },
    'utils/variant-generator.ts': { where: 'self', note: 'A/B 자동 생성 = 자기 출구(고치기)' },
    'utils/journey-interview-ai.ts': { where: 'none', note: '질문 고르기 · 글은 generateJourneyPackage(자기 출구)가 쓴다' },
    'utils/journey-trigger-suggest.ts': { where: 'none', note: '시작 사건 고르기 · 고객 글 아님' },
  };
  it('여정 AI 생산자 목록 = 손 표(새 생산자는 출구를 정해야 통과)', () => {
    const found = files.filter((f) => (/^utils\/journey-[^/]+\.ts$/.test(f) || f === 'utils/variant-generator.ts') && /\b(callAIWithFallback|runChargedAi)\s*\(/.test(read(f)));
    expect(found.sort()).toEqual(Object.keys(PRODUCERS).sort());
  });
  it('자기 출구 생산자 = 출구 함수를 부른다', () => {
    for (const [f, p] of Object.entries(PRODUCERS)) if (p.where === 'self') expect({ f, ok: /\bfinish(Many|Copy)\s*\(/.test(read(f)) }).toEqual({ f, ok: true });
    // ★ Codex 구현 1R #1 — 고치기 출구(실패할 수 있는 출구) = 정산 안(생산자 함수) · 다듬기 · 꾸미기 · 스팸 재작성
    const gen = read('utils/journey-ai-generator.ts');
    expect(gen).toMatch(/producer: 'journey-step-refine', mode: hasBody \? 'rewrite' : 'write'/);
    expect(gen).toMatch(/producer: 'journey-pretest-regen', mode: 'rewrite'/);
    expect(read('utils/operator-message-decorator.ts')).toMatch(/run: async \(\) => \{[\s\S]*finishMany\([\s\S]*producer: 'decorate', mode: 'rewrite'[\s\S]*accept: \(r\) => r\.kept\.length < msgs\.length/);
    expect(read('utils/journey-pretest-notifier.ts')).not.toMatch(/\bfinish(Copy|Many)\(/);   // 정산 뒤 다시 거르면 차감 뒤 빈손
  });
  it('주소 출구 = 쓰기(실패 없음)만 — 날짜축 계획 · AI 수정 · 고치기 출구는 주소에 없다(Codex 구현 1R #1)', () => {
    const r = read('routes/ai.ts');
    const body = (path: string) => { const i = r.indexOf(`'/operator/${path}'`); expect(i).toBeGreaterThan(0); return r.slice(i, r.indexOf('\nrouter.', i + 10)); };
    for (const p of ['journeys/anchor-generate-plan', 'journeys-ai-edit']) expect({ p, ok: /finishMany\([\s\S]*mode: 'write'/.test(body(p)) }).toEqual({ p, ok: true });
    expect(r).not.toMatch(/mode: 'rewrite'|\? 'rewrite'/);
  });
});

describe('C2 출구 = 검사 + 표식 · 글을 바꾸지 않는다(Codex 구현 3R · 사실 판정 = 생산자)', () => {
  it('출구는 글 · 제목을 그대로 돌려준다(원장 링크 숫자 · 전송자 이름 · 사람 제목 · 효능처럼 보이는 낱말)', async () => {
    const { finishCopy } = await import('../copy-finish');
    const text = '[치유의숲]\n행사장에 방문해 주세요.\n> 상품: https://shop.example.invalid/product/123';
    const c = await finishCopy({ companyId: 'c', producer: 't', mode: 'rewrite', text, subject: '주름 개선 기능성', before: '행사장에 방문해 주세요.', channel: 'lms', isAd: true });
    expect(c.text).toBe(text);
    expect(c.subject).toBe('주름 개선 기능성');
  });

  it('출구 파일에 사실 판정 0(혜택 · 효능 · 숫자 · 링크) · 실패 0', () => {
    expect(read('utils/copy-finish.ts')).not.toMatch(/copy-benefit-detector|replaceInventedBenefits|dropInventedEfficacy|rewriteAddsFacts|rewriteDropsLinks|ok: false/);
  });

  it('고치기 사실 판정 = 생산자 한 곳(다듬기 · 꾸미기 · A/B · 스팸 재작성이 숫자 · 혜택 · 효능 · 링크를 스스로 본다)', () => {
    const gen = read('utils/journey-ai-generator.ts');
    const refine = gen.slice(gen.indexOf('async function refineStepMessageWithAi'), gen.indexOf('export async function generateAnchorStepMessage'));
    for (const fn of ['replaceInventedBenefits(', 'findNewNumbers(', 'rewriteDropsLinks(', 'claimsInventedEfficacy(']) expect({ fn, ok: refine.includes(fn) }).toEqual({ fn, ok: true });
    const regen = gen.slice(gen.indexOf('async function regenerateStepAvoidingSpamWithAi'));
    for (const fn of ['findInventedBenefits(', 'findNewNumbers(', 'claimsInventedEfficacy(', 'rewriteDropsLinks(']) expect({ fn, ok: regen.includes(fn) }).toEqual({ fn, ok: true });
    const dec = read('utils/operator-message-decorator.ts');
    expect(dec).toMatch(/!rewriteAddsFacts\(candOut, origOut\)/);   // 정제한 글끼리(3R #2)
    expect(dec).toMatch(/rewriteDropsLinks\(made, origOut\)/);
    expect(read('utils/variant-generator.ts')).toMatch(/rewriteAddsFacts\(v\.messageTemplate, baseMessage\) \|\| rewriteDropsLinks\(v\.messageTemplate, baseMessage\)/);
  });

  it('즉시 검사 = 바이트 · 남은 자리 · 금지어 · 꼴', async () => {
    const { quickCheckOf } = await import('../copy-finish');
    expect(quickCheckOf({ text: '가'.repeat(60), channel: 'sms', isAd: true }).items.map((i) => i.key)).toContain('bytes');
    expect(quickCheckOf({ text: '자세히 → [URL 입력]', channel: 'lms', isAd: true }).items.map((i) => i.key)).toContain('placeholder');
    expect(quickCheckOf({ text: '최저가 보장', channel: 'lms', isAd: false, bannedWords: ['최저가'] }).items.map((i) => i.key)).toContain('banned');
    expect(quickCheckOf({ text: '%고객명%님 반가워요.', channel: 'lms', isAd: false }).quick).toBe('ok');
  });
});

describe('C7 화면 입구 하나', () => {
  const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
  const fe = (rel: string) => stripComments(readFileSync(join(FE, rel), 'utf8').replace(/\r\n/g, '\n'));
  it('AI 글을 칸에 넣는 자리 = 입구 함수(check 없으면 안 넣음)', () => {
    expect(fe('utils/ai-copy-entry.ts')).toMatch(/if \(text == null \|\| !isAiQuickCheck\(o\.check\)\) return \{ ok: false/);
    expect((fe('components/journey/workspace/JourneyWorkspace.tsx').match(/aiCopyEntry\(/g) || []).length).toBe(2);
    expect((fe('pages/JourneysPage.tsx').match(/aiCopyEntr(y|iesAll)\(/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(fe('components/journey/JourneyVariantsEditor.tsx')).toMatch(/aiCopyEntriesAll\(/);
  });
});

describe('C91 후속(Harold 1101 화면) — 작업 화면 전체 화면 · 최대 인원 선택 · 0% 빠짐', () => {
  const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
  const fe = (rel: string) => stripComments(readFileSync(join(FE, rel), 'utf8').replace(/\r\n/g, '\n'));

  it('작업 화면 = 직접발송처럼 화면을 꽉 채운다(창 껍데기 fullScreen = 둘레 여백 · 둥근 모서리 0)', () => {
    expect(fe('components/journey/workspace/JourneyWorkspace.tsx')).toMatch(/labelledBy="jws-title"[\s\S]{0,200}fullHeight fullScreen>/);
    const shell = fe('components/journey/JourneyModalShell.tsx');
    expect(shell).toMatch(/fullScreen \? '' : 'md:p-6'/);
    expect(shell).toMatch(/fullScreen \? 'h-\[100dvh\] w-screen max-w-none rounded-none border-0'/);
  });

  it('최대 인원 = 선택 — 켜기 · 정의 검사에 필수 조건 0 · 판정 함수 · 면제 목록 0', () => {
    const b = read('utils/journey-builder.ts');
    expect(b).not.toMatch(/threshold_recipients_per_step IS NOT NULL OR trigger_event = ANY/);
    expect(b).not.toMatch(/한 번에 보낼 최대 인원을 정해 주세요/);
    for (const f of files) expect({ f, ok: !/\brequiresRecipientCap\b|\bCAP_EXEMPT_TRIGGERS\b/.test(read(f)) }).toEqual({ f, ok: true });
  });

  it('켜기 확인 창 · 일괄 켜기 · 시작 카드 = 비워도 된다(비우면 「한꺼번에 나간다」 한 줄)', () => {
    const confirm = fe('components/journey/JourneyActivationConfirmModal.tsx');
    expect(confirm).toMatch(/const capNum: number \| null = capEmpty \? null/);
    expect(confirm).toMatch(/정하지 않으면 제한 없이 보내요\. 고객 정보를 한꺼번에 옮겨 오면 들어온 분 모두에게 한꺼번에 나가요\./);
    expect(confirm).not.toMatch(/회차마다 나눠/);   // 실제 값(JOURNEY_COUNT_CAP 100000)과 다른 말 금지
    expect(fe('components/journey/map/BatchActivateModal.tsx')).toMatch(/const capOk = \(id: string\) => \{ const n = capOf\(id\); return n == null \|\|/);
    expect(fe('components/journey/map/BatchActivateModal.tsx')).toMatch(/capOf\(c\.id\) == null && \([\s\S]{0,120}정하지 않으면 제한 없이 보내요\. 고객 정보를 한꺼번에 옮겨 오면 들어온 분 모두에게 한꺼번에 나가요\./);   // Codex C92 1R
    expect(fe('components/journey/workspace/JourneyStartCard.tsx')).toMatch(/placeholder="비우면 제한 없음"/);
  });

  it('상한 없는 회차 = 회차당 JOURNEY_COUNT_CAP(10만) · 날짜 기준 · 한 번 보내기는 끝까지(R40) — 주석 · 문구가 상수 값과 같다', async () => {
    const { JOURNEY_COUNT_CAP } = await import('../journey-target-extractor');
    expect(JOURNEY_COUNT_CAP).toBe(100000);
    expect(read('utils/journey-trigger-watcher.ts')).not.toMatch(/500 스로틀로 회차 분산/);
  });

  it('레일 둘째 줄 이탈 = 실제로 빠진 사람이 있을 때만(0% 빠짐 소음 0)', () => {
    expect(fe('components/journey/workspace/JourneyWorkspace.tsx')).toMatch(/dg\.severity !== 'good' && Math\.round\(Number\(dg\.dropoutRate \|\| 0\) \* 100\) > 0/);
  });
});
