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
import { resolveRetestCopy, PROPOSAL_SPAM_RETEST_LIMIT } from '../continuous-operator-policy';

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

describe('resolveRetestCopy — 발송과 같은 순서로 검사할 문안을 정한다', () => {
  it('고르기만 한 안 = 그 안의 본문 · 제목', () => {
    expect(resolveRetestCopy(pj('LMS'), { variantIndex: 0 })).toMatchObject({ ok: true, body: '1안 본문', subject: '1안 제목', msgType: 'LMS' });
  });

  it('고친 본문 · 제목이 오면 그것', () => {
    expect(resolveRetestCopy(pj('LMS'), { variantIndex: 0, body: '고친 본문', subject: '고친 제목' })).toMatchObject({ ok: true, body: '고친 본문', subject: '고친 제목' });
  });

  it('message 칸만 있는 안도 읽는다', () => {
    expect(resolveRetestCopy(pj('SMS'), { variantIndex: 2 })).toMatchObject({ ok: true, body: '3안 본문', subject: '' });
  });

  it('단문을 90byte 넘게 고치면 장문으로 검사한다(발송 승격과 같다)', () => {
    const long = '가'.repeat(46); // 92byte
    expect(resolveRetestCopy(pj('SMS'), { variantIndex: 0, body: long })).toMatchObject({ ok: true, msgType: 'LMS' });
    expect(resolveRetestCopy(pj('SMS'), { variantIndex: 0, body: '짧은 문안' })).toMatchObject({ ok: true, msgType: 'SMS' });
  });

  it('없는 안 · 빈 문안은 거절', () => {
    expect(resolveRetestCopy(pj('SMS'), { variantIndex: 5 })).toMatchObject({ ok: false });
    expect(resolveRetestCopy({ messages: [{ body: '' }] }, { variantIndex: 0 })).toMatchObject({ ok: false });
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
  it('본문에 [혜택 …] 이 남으면 거절 · 혜택을 직접 넣으라고 안내', () => {
    const r = resolveRetestCopy(pj('LMS'), { variantIndex: 1 });
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toContain('혜택을 직접 넣은 뒤');
  });

  it('제목 · 직접 입력 안내 문구도 같다', () => {
    expect(resolveRetestCopy(pj('LMS'), { variantIndex: 0, subject: '[혜택] 안내' })).toMatchObject({ ok: false });
    expect(resolveRetestCopy(pj('LMS'), { variantIndex: 0, body: '혜택은 직접 입력해주세요' })).toMatchObject({ ok: false });
  });

  it('혜택을 문안에 직접 넣으면 검사한다 · 그 글자가 그대로 나간다(발송 치환은 자리가 없으면 그대로)', async () => {
    const { applyBenefitToBody } = await import('../autosend-policy');
    const r = resolveRetestCopy(pj('LMS'), { variantIndex: 1, body: '2안 10% 할인 본문' });
    expect(r).toMatchObject({ ok: true, body: '2안 10% 할인 본문' });
    expect(applyBenefitToBody('2안 10% 할인 본문', '30% 할인')).toBe('2안 10% 할인 본문');
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
    // ★ 2026-10-07 고른 회신번호가 있으면 그 번호 · 없으면(개별 회신 포함) 기본 발신번호
    expect(round).toContain('const spamCallback = (await loadOperatorCallback(operator.companyId, operator.useIndividualCallback ? null : operator.callbackNumber)) || callbackForSpam;');
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
    expect(round).toContain('computeMessageHash(`${spamCallback}\\n${bestSubject}\\n${bestMessage}`)');
    expect(round.indexOf('const spamCallback =')).toBeLessThan(round.indexOf('const fixedHash ='));
  });
});

describe('라우트 — 권한 · 요금제 게이트는 승인과 같다', () => {
  const routes = back('routes/ai.ts');
  const post = routes.slice(routes.indexOf("router.post('/operator/proposals/:id/spam-test'"), routes.indexOf("router.get('/operator/proposals/:id/spam-test'"));

  it('본인 자동마케팅(또는 회사 관리자) · 요금제 게이트', () => {
    expect(post).toContain("userType !== 'company_admin' && own.rows[0].created_by !== userId");
    expect(post).toContain('isAiOperatorAllowed(planCtx, req.user)');
    expect(post).toContain('startProposalSpamRetest(companyId, req.params.id, userId');
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
    // 선택이 있으면 승인은 그 안 · 본문 · 제목을 싣는다
    expect(card).toContain('onApprove({ variantIndex: effectiveIdx, body: effectiveBody, subject: editedSubject != null ? editedSubject : effectiveMsg?.subject });');
    expect(card).toContain('if (selectedIdx == null && editedBody == null && editedSubject == null) { onApprove(); return; }');
  });

  it('결과는 안 번호 · 본문 · 제목이 모두 같을 때만 붙는다', () => {
    expect(card).toContain('r.variantIndex === i && r.body === body && (r.subject || \'\') === subject');
  });

  it('고친 문안에는 자동 검사 결과(고치기 전 문안 판정)를 붙이지 않는다', () => {
    expect(card).toContain('const autoHit = isSel && (editedBody != null || editedSubject != null) ? undefined : spamResultAt(i);');
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
