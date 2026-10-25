/**
 * 자동마케팅 화면 스팸 검사 (★2026-10-06 임은지 재오픈 `cmuqcxfib0b5bjnn409ij7ncl`)
 *
 * 「스팸 통과된 문안 1개 외에 자동추천된 2개의 문안이나 문안 편집 후 스팸테스트를 진행할 수 있는 기능」.
 * 1003 수정으로 3안 선택 · 문안 편집은 됐지만 고른 안 · 고친 문안을 검사할 길이 없었다 → 정지 문자의 「문안 검토 후 재개」를 할 수 없었다.
 * 처방: 카드에 「이 문안 스팸 검사」(자동 검사와 같은 검사 · 무료 · 제안마다 5회 · Harold 1006) · 결과는 같은 글자에만 · 정지 문자에 방법 안내.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { PROPOSAL_SPAM_RETEST_LIMIT } from '../continuous-operator-policy';
import { operatorFinalCopyAt } from '../operator-final-copy';
import { hasUneditedBenefitPlaceholder } from '../autosend-policy';

const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8');

const pj = (channel: string) => ({
  channel: { recommended: channel },
  messages: [
    { body: '1안 본문', subject: '1안 제목' },
    { body: '2안 [혜택 입력] 본문', subject: '2안 제목' },
    { message: '3안 본문' },
  ],
});

// ★ 2026-10-25 원장 #29 — 검사할 글 = 발송 CT(operatorFinalCopyAt) 한 벌(옛 resolveRetestCopy 삭제 · 「발송 쪽을 바꾸면 여기도」 0)
const CTX = { benefit: null, opt080: '0800000000', callback: '0200000000' };
const at = (p: any, i: number, sel?: { body?: string; subject?: string }) =>
  operatorFinalCopyAt(sel ? { ...p, userSelection: { variantIndex: i, ...sel } } : p, i, CTX);

describe('검사할 글 = 발송과 같은 함수(operatorFinalCopyAt)', () => {
  it('고르기만 한 안 = 그 안의 본문 · 제목', () => {
    expect(at(pj('LMS'), 0)).toMatchObject({ body: '1안 본문', subject: '1안 제목', msgType: 'LMS' });
  });

  it('고친 본문 · 제목이 오면 그것', () => {
    expect(at(pj('LMS'), 0, { body: '고친 본문', subject: '고친 제목' })).toMatchObject({ body: '고친 본문', subject: '고친 제목' });
  });

  it('message 칸만 있는 안도 읽는다', () => {
    expect(at(pj('SMS'), 2)).toMatchObject({ body: '3안 본문', subject: '' });
  });

  it('단문이 90byte 를 넘으면 장문으로 검사한다(고쳤든 안 고쳤든 · 발송 승격과 같다 · #29)', () => {
    const long = '가'.repeat(46); // 92byte
    expect(at(pj('SMS'), 0, { body: long })).toMatchObject({ msgType: 'LMS' });
    expect(at({ channel: { recommended: 'SMS' }, messages: [{ body: long }] }, 0)).toMatchObject({ msgType: 'LMS' });
    expect(at(pj('SMS'), 0, { body: '짧은 문안' })).toMatchObject({ msgType: 'SMS' });
  });

  it('없는 안 = null', () => {
    expect(at(pj('SMS'), 5)).toBeNull();
  });

  it('횟수 = 제안마다 5회(Harold 1006)', () => {
    expect(PROPOSAL_SPAM_RETEST_LIMIT).toBe(5);
  });
});

/**
 * ★ Codex 1R · 2R · 3R medium(같은 뿌리) — 혜택은 서버에만 있어 화면이 「지금 나갈 문안」을 몰랐다:
 *   1R 혜택이 바뀌어도 지난 통과 표시 · 2R 받아 둔 결과 미갱신 · 3R 재조회 실패 · 응답 역전.
 * 구조 정정 = 혜택 자리가 남은 문안은 검사하지 않는다(혜택을 문안에 직접 넣은 뒤 검사).
 *   혜택 자리가 없으면 발송의 혜택 치환이 아무것도 바꾸지 않으므로 검사한 글자 = 화면 글자 = 나가는 글자.
 */
describe('혜택 자리가 남은 문안은 검사하지 않는다(검사한 글자 = 화면 글자 = 나가는 글자)', () => {
  const op = back('utils/continuous-operator.ts');
  const fn = op.slice(op.indexOf('export async function startProposalSpamRetest('), op.indexOf('export async function readProposalSpamRetest('));
  it('본문 · 제목에 [혜택 …] 이 남으면 거절 · 혜택을 직접 넣으라고 안내(입력 글로 판정 · 검사 전)', () => {
    expect(fn).toContain('if (hasUneditedBenefitPlaceholder(rawBody) || hasUneditedBenefitPlaceholder(rawSubject)) {');
    expect(fn).toContain('문안 편집에서 혜택을 직접 넣은 뒤 검사해 주세요.');
    expect(fn.indexOf('hasUneditedBenefitPlaceholder(rawBody)')).toBeLessThan(fn.indexOf('operatorFinalCopyAt('));
  });

  it('제목 · 직접 입력 안내 문구도 혜택 자리다', () => {
    expect(hasUneditedBenefitPlaceholder('[혜택] 안내')).toBe(true);
    expect(hasUneditedBenefitPlaceholder('혜택은 직접 입력해주세요')).toBe(true);
    expect(hasUneditedBenefitPlaceholder('2안 10% 할인 본문')).toBe(false);
  });

  it('혜택을 문안에 직접 넣으면 검사한다 · 그 글자가 그대로 나간다(발송 치환은 자리가 없으면 그대로)', () => {
    const r = operatorFinalCopyAt({ ...pj('LMS'), userSelection: { variantIndex: 1, body: '2안 10% 할인 본문' } }, 1, { ...CTX, benefit: '30% 할인' });
    expect(r).toMatchObject({ body: '2안 10% 할인 본문', placeholderLeft: false });
  });

  it('검사 함수는 혜택 값을 받지 않는다 · 혜택 대조 장치는 없다', () => {
    const pol = back('utils/continuous-operator-policy.ts');
    expect(pol).not.toContain('currentSpamRetest');
    expect(pol).not.toContain('testedBody');
  });
});

describe('서버 — 자동 검사와 같은 검사 · 실제 발송과 같은 번호 · 한 문장 선점', () => {
  const op = back('utils/continuous-operator.ts');
  const fn = op.slice(op.indexOf('export async function startProposalSpamRetest('), op.indexOf('export async function readProposalSpamRetest('));

  it('승인 전 제안만 · 기본 발신번호 · 080 = 발송과 같은 출처', () => {
    expect(fn).toContain("['pending', 'admin_review']");
    expect(fn).toContain('FROM callback_numbers WHERE company_id = $1 AND is_default = true');
    expect(fn).toContain('getOpt080Number(row.created_by || null, companyId)');
  });

  it('횟수 · 진행 중 확인과 증가가 한 문장(두 번 눌러도 하나만 선다) · 10분 넘은 표식은 이어받는다', () => {
    const claim = fn.slice(fn.indexOf('const claim = await query('), fn.indexOf('if (claim.rows.length === 0)'));
    expect(claim).toContain("COALESCE((proposal_json #>> '{spamRetest,count}')::int, 0) < $5::int");
    expect(claim).toContain("proposal_json #> '{spamRetest,running}' IS NULL");
    expect(claim).toContain("< NOW() - INTERVAL '10 minutes'");
    expect(claim).toContain("status IN ('pending', 'admin_review')");
  });

  it('검사 = 무료 자동 검사 경로 한 안 · 재생성 없음 · 광고 표기', () => {
    expect(fn).toContain('autoSpamTestWithRegenerate({');
    expect(fn).toContain('maxRetries: 0');
    expect(fn).toContain('isAd: true');
    expect(fn).toContain('rejectNumber: a.opt080');
  });

  it('끝 기록은 자기 토큰일 때만 · 진행 표식을 지우고 결과를 쌓는다', () => {
    expect(fn).toContain("WHERE id = $1::uuid AND proposal_json #>> '{spamRetest,running,token}' = $2");
    expect(fn).toContain("proposal_json #- '{spamRetest,running}'");
    expect(fn).toContain('variantIndex: a.variantIndex, body: a.copy.body, subject: a.copy.subject,');
  });

  it('검사 경로 무료(차감 건너뜀)는 그대로', () => {
    expect(back('utils/spam-test-queue.ts')).toContain('skipPrepaid: true');
  });

  it('정지 문자가 화면에서 할 일을 알려 준다', () => {
    expect(op).toContain('제안 상세에서 다른 추천 문안을 고르거나 문안을 고친 뒤 스팸 검사를 하고 승인할 수 있습니다');
    expect(op).not.toContain('문안 검토 후 재개해주세요');
  });
});

/**
 * 회차 자동 검사의 발신번호 (★2026-10-06 Harold 승인 · 실측 = 10-01~10-06 자동마케팅 검사 9건 발신 전부 080 수신거부 번호)
 * 옛: callbackForSpam = companyInfo.callback || companyInfo.callback_number || ctx.reject_number 인데 companyInfo 에 발신번호 칸이 없다
 *     → 검사는 080 으로 · 실제 발송은 기본 발신번호로(검사 조건 ≠ 발송 조건). 다른 검사 호출처(대행 · 자동발송 · 플래너 · 리마인드)는 발송 번호로 검사한다.
 */
describe('회차 자동 검사 — 실제 발송과 같은 기본 발신번호로 검사한다', () => {
  const op = back('utils/continuous-operator.ts');
  const round = op.slice(op.indexOf('// 9. ★ D227+ 스팸 안전망'), op.indexOf('const tested: Array<'));

  it('검사에 넘기는 번호 = 기본 발신번호(없으면 종전 값) · 자격 판정 값은 그대로', () => {
    // ★ 2026-10-07 고른 회신번호가 있으면 그 번호 · 없으면(개별 회신 포함) 기본 발신번호 · ★ 1024 최종 문안 문맥(copyCtx)과 같은 값이라 검사 전에 정한다
    // ★ 1024 Codex 1R — 지문 문맥의 번호 = 발송이 쓰는 값(대체 번호 0) · 검사 운반 번호만 대체 값
    expect(op).toContain("const sendCallback = (await loadOperatorCallback(operator.companyId, operator.useIndividualCallback ? null : operator.callbackNumber)) || '';");
    expect(op).toContain('const spamCallback = sendCallback || callbackForSpam;');
    expect(op).toContain('const copyCtx = { benefit: operator.benefitContent, opt080: adOpt080, callback: sendCallback };');
    expect(round).toContain('callbackNumber: spamCallback,');
    expect(round).not.toContain('callbackNumber: callbackForSpam');
    expect(op).toContain("const canAutoSend = !!bestMessage && !!callbackForSpam && channelForSpam !== '카카오'");
  });

  it('기본 발신번호 = 발송(dispatchProposalSend)과 같은 조건', () => {
    const helper = op.slice(op.indexOf('async function loadDefaultCallback('), op.indexOf('/** 화면이 검사 진행'));
    expect(helper).toContain("FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1");
    // ★ 2026-10-07 발송도 같은 함수(고른 번호 → 없으면 기본 번호)를 쓴다
    const pick = op.slice(op.indexOf('async function loadOperatorCallback('), op.indexOf('async function loadOperatorCallback(') + 400);
    expect(pick).toContain('return c || loadDefaultCallback(companyId);');
    expect(op).toContain('callback = await loadOperatorCallback(companyId, chosenCb) || null;');
  });

  it('직접 쓴 문안의 통과 기록 지문에 발신번호가 들어간다(080 으로 검사한 옛 통과가 실제 번호 검사를 건너뛰지 않게)', () => {
    // ★ 1024 Codex 2R — 기록 키 = 검사한 모양의 지문 한 함수(검사 번호 · 080 · 채널 · 제목 · 본문 · 080 만 바뀌어도 다시 검사)
    expect(round).toContain('copyFingerprint({ callback: spamCallback, opt080: adOpt080, msgType: testType, subject: bestSubject, body: bestMessage })');
    expect(round).not.toContain('computeMessageHash(');
    expect(round.indexOf('const spamCallback =')).toBeLessThan(round.indexOf('const fixedHash ='));
  });
});

describe('라우트 — 권한 · 요금제 게이트는 승인과 같다', () => {
  const routes = back('routes/ai.ts');
  const post = routes.slice(routes.indexOf("router.post('/operator/proposals/:id/spam-test'"), routes.indexOf("router.get('/operator/proposals/:id/spam-test'"));

  it('본인 자동마케팅(또는 회사 관리자) · 요금제 게이트 = 문 한 벌(operatorGate · ★ 1024)', () => {
    expect(post).toContain('const gate = await operatorGate(req, res, { plan: true });');
    expect(post).toContain('startProposalSpamRetest(gate.companyId, req.params.id, gate.userId');
  });
});

describe('화면 — 고른 안 · 고친 문안에서 검사 · 같은 글자에만 결과', () => {
  const card = front('components/automarketing/ProposalDecisionCard.tsx').replace(/\r\n/g, '\n');

  it('선택한 안에 검사 버튼 · 지금 화면 문안을 보낸다', () => {
    expect(card).toContain("'이 문안 스팸 검사'");
    expect(card).toContain('body: JSON.stringify({ variantIndex: effectiveIdx, body: effectiveBody, subject: effectiveSubject })');
  });

  it('★ Codex 4R high — 검사를 시작하면 그 안이 발송 선택으로 고정된다(선택 없는 승인 = 서버가 추천을 다시 뽑는다)', () => {
    const at = card.indexOf('const startRetest = async () => {');
    const start = card.slice(at, card.indexOf('await fetch(', at));
    expect(start).toContain('if (selectedIdx == null) setSelectedIdx(effectiveIdx);');
    // ★ 2026-10-24 승인 = 늘 안 번호 + 그 안의 지문(선택 없는 승인 0 · 서버가 다시 뽑지 않는다) · 고친 글만 함께
    expect(card).toContain('variantIndex: effectiveIdx,\n      fingerprint: effectiveFinal.fingerprint,\n      ...(edited ? { body: effectiveBody, subject: effectiveSubject } : {}),');
    expect(card).not.toContain('onApprove();');
  });

  it('결과는 안 번호 · 본문 · 제목이 모두 같을 때만 붙는다', () => {
    // ★ 1025 #29 — 결과 글 = 나가는 글 · 화면이 보낸 입력 글(srcBody)로도 붙인다
    expect(card).toContain("[...(retest?.results || [])].reverse().find((r) => r.variantIndex === i\n      && (r.body === body || r.srcBody === body)\n      && ((r.subject || '') === subject || (r.srcSubject ?? null) === subject));");
  });

  it('고친 문안에는 자동 검사 결과(고치기 전 문안 판정)를 붙이지 않는다', () => {
    expect(card).toContain('const autoHit = isSel && edited ? undefined : spamResultAt(i);');
  });

  it('처음 값 = 제안에 저장된 결과 · 덧댄 다시 읽기 장치(탭 복귀 · 상위 재조회)는 없다(글자 비교로 충분)', () => {
    expect(card).toContain('useState<ProposalSpamRetest | null>(pj.spamRetest || null)');
    expect(card).not.toContain('visibilitychange');
  });

  it('검사 중이면 다시 읽고 · 문자로 못 보내는 글자 · 빈 제목이면 막는다', () => {
    expect(card).toContain('/spam-test`, { headers: authHeader() }');
    expect(card).toContain('const t = setInterval(() => { void loadRetest(); }, 4000);');
    expect(card).toMatch(/disabled=\{busy \|\| retestStarting \|\| retestRunning \|\| retestLeft === 0 \|\| charsetInvalid \|\| subjectInvalid/);
  });
});
