/**
 * 세 채널(인앱 · 모바일 DM · 이메일) 구조체크 결함 계약 시험 (★ 2026-10-24 · 보고서 17건 · 뿌리 = docs/ROOT-LEDGER.md)
 *
 * 소스 계약(고친 자리가 그대로 있는가) + 순수 판정의 동작. 같은 뿌리의 기능 넘는 계약(R2 머리 문 · R10 4xx)은 root-ledger.test.ts 가 소유한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('../../config/database', () => ({ query: (...a: any[]) => queryMock(...a), pool: { connect: vi.fn() }, withTransaction: vi.fn() }));

const BE = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const be = (rel: string) => read(join(BE, rel));
const fe = (rel: string) => read(join(FE, rel));
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const fnBody = (src: string, decl: string) => {
  const at = src.indexOf(decl);
  expect(at, decl).toBeGreaterThan(-1);
  const next = src.slice(at + decl.length).search(/\n(?:export\s+)?(?:async\s+)?function\s/);
  return src.slice(at, next > 0 ? at + decl.length + next : undefined);
};
const routeBody = (src: string, decl: string) => {
  const at = src.indexOf(decl);
  expect(at, decl).toBeGreaterThan(-1);
  const end = src.indexOf('\n});\n', at);
  const end2 = src.indexOf('\n}, SEND_IN_FLIGHT_MESSAGE));\n', at);
  const cut = [end, end2].filter((x) => x > 0);
  return src.slice(at, Math.min(...cut));
};

beforeEach(() => { queryMock.mockReset(); });

describe('① 이메일 거부 신호 — 고객 표 갱신은 읽기와 같은 축 · 발송 길목이 거른다', () => {
  const ch = be('utils/email-channel.ts');
  it('수신거부 · 반송 · 스팸 = 한 셋 · 고객 표 갱신이 값 빈(NULL) 행도 바꾼다', () => {
    expect(ch).toContain("export const EMAIL_SUPPRESS_EVENTS = ['unsubscribe', 'bounce', 'spam_report'] as const;");
    expect(ch).toContain('(EMAIL_SUPPRESS_EVENTS as readonly string[]).includes(eventType)');
    expect(ch).toContain('AND email_opt_in IS DISTINCT FROM false');
    expect(stripComments(ch)).not.toMatch(/AND email_opt_in = true`/);
  });
  it('발송 엔진(단일 길목)이 보낼 명단을 거부 신호로 거른 뒤 보낸다 · 즉시 발송 화면 수도 같은 판정', () => {
    const engine = fnBody(ch, 'async function sendEmailCampaignInner(');
    const f = engine.indexOf('filterEmailSuppressed(campaign.companyId, input.recipients)');
    expect(f).toBeGreaterThan(-1);
    expect(engine.indexOf('allowed.recipients')).toBeGreaterThan(f);
    expect(engine).not.toMatch(/:\s*input\.recipients;/);
    expect(be('routes/email.ts')).toContain('const suppressed = await filterEmailSuppressed(auth.companyId, resolved);');
  });
  it('거름 = 회사 메일의 거부 이벤트 주소(대소문자 무시)', async () => {
    const { filterEmailSuppressed } = await import('../email-channel');
    queryMock.mockResolvedValueOnce({ rows: [{ email: 'a@x.test' }] });
    const r = await filterEmailSuppressed('c1', [{ email: 'A@x.test' }, { email: 'b@x.test' }]);
    expect(r.recipients).toEqual([{ email: 'b@x.test' }]);
    expect(r.excludedCount).toBe(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('JOIN email_campaigns c ON c.id = e.campaign_id');
    expect(params[1]).toEqual(['unsubscribe', 'bounce', 'spam_report']);
    expect(params[2]).toEqual(['a@x.test', 'b@x.test']);
  });
});

describe('⑭ ⑰ DM 발행 — 주소 확정 + 경품 동기화 = 한 함수 · 동시 첫 발행은 먼저 쓴 주소', () => {
  it('publishDm( 를 직접 부르는 곳은 발행 코어 하나다(새 발행 문이 경품 동기화를 빠뜨리지 않게)', () => {
    const files = (readdirSync(BE, { recursive: true }) as string[]).map((f) => String(f).replace(/\\/g, '/'))
      .filter((f) => /\.ts$/.test(f) && !/__tests__\/|\.test\.ts$|^dist|node_modules/.test(f));
    const callers = files.filter((f) => /\bpublishDm\(/.test(stripComments(be(f)).replace(/export async function publishDm\(/, '')));
    expect(callers).toEqual(['utils/dm/dm-publish-core.ts']);
    const core = be('utils/dm/dm-publish-core.ts');
    const w = fnBody(core, 'export async function publishDmWithPrizes(');
    // 경품을 먼저 맞추고(실패 = 던짐 · 삼키지 않는다) 주소를 확정한다 · Codex 1R
    expect(w.indexOf('await syncPrizesFromSections(companyId, dmId);')).toBeGreaterThan(-1);
    expect(w.indexOf('await syncPrizesFromSections(')).toBeLessThan(w.indexOf('publishDm(dmId, companyId)'));
    expect(stripComments(w)).not.toMatch(/catch/);
    expect(fnBody(core, 'export async function publishDmCore(')).toContain('await publishDmWithPrizes(dmId, companyId)');
    const send = routeBody(be('routes/dm.ts'), "dmRouter.post('/:id/send-to-target'");
    expect(send).toContain('await publishDmWithPrizes(req.params.id, companyId)');
    // 발행비는 경품 준비 · 발행이 성공한 뒤에 걷는다(실패 = 돈 0)
    expect(send.indexOf('await publishDmWithPrizes(')).toBeLessThan(send.indexOf('idempotencyKey: `dm-publish:${req.params.id}`'));
  });
  it('주소는 빈 행에만 쓰고 졌으면 이긴 주소를 돌려준다', () => {
    const b = fnBody(be('utils/dm/dm-builder.ts'), 'export async function publishDm(');
    expect(b).toContain('WHERE id = $2 AND company_id = $3 AND short_code IS NULL RETURNING short_code');
    expect(b).toContain('const won = await query(');
  });
});

describe('③ 끄기 요청은 머리 요금제 문 밖', () => {
  it('공용 끄기 판정 + DM 끄기(A/B 종료 · 단축 링크 끄기)', async () => {
    const { isPlanControlRequest } = await import('../plan-guard');
    const { isDmControlRequest } = await import('../dm-access');
    expect(isPlanControlRequest({ method: 'DELETE', path: '/abc' })).toBe(true);
    expect(isPlanControlRequest({ method: 'POST', path: '/x/stop' })).toBe(true);
    expect(isPlanControlRequest({ method: 'POST', path: '/posts/x/cancel' })).toBe(true);
    expect(isPlanControlRequest({ method: 'POST', path: '/accounts/x/disconnect' })).toBe(true);
    expect(isPlanControlRequest({ method: 'POST', path: '/x/publish' })).toBe(false);
    expect(isPlanControlRequest({ method: 'POST', path: '/x/resume' })).toBe(false);
    expect(isDmControlRequest({ method: 'POST', path: '/ab-tests/t1/complete' })).toBe(true);
    expect(isDmControlRequest({ method: 'POST', path: '/ab-tests/t1/pause' })).toBe(true);
    expect(isDmControlRequest({ method: 'POST', path: '/ab-tests/t1/start' })).toBe(false);
    expect(isDmControlRequest({ method: 'PATCH', path: '/short-links/l1', body: { isActive: false } })).toBe(true);
    expect(isDmControlRequest({ method: 'PATCH', path: '/short-links/l1', body: { isActive: true } })).toBe(false);
    expect(isDmControlRequest({ method: 'POST', path: '/:id/send-to-target' })).toBe(false);
  });
  it('머리 문이 except 를 먼저 본다', async () => {
    const { requirePlanFeature } = await import('../plan-guard');
    const next = vi.fn();
    await requirePlanFeature('mobile_dm', { except: () => true })({ method: 'POST', path: '/x/stop' } as any, {} as any, next);
    expect(next).toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('④ 미리보기 · 샘플 고객 = 발송과 같은 담당자 범위', () => {
  it('네 함수가 범위 CT 를 지나고 라우트가 담당자를 넘긴다', () => {
    const ch = be('utils/email-channel.ts');
    for (const d of ['export async function previewCustomerRecipients(', 'export async function listCustomerGrades(']) {
      expect(fnBody(ch, d), d).toContain("getOwnerCustomerScopeSql(companyId, ownerUserId, '')");
    }
    expect(be('utils/dm/dm-sample-customer.ts')).toContain("getOwnerCustomerScopeSql(companyId, ownerUserId, '')");
    expect(fnBody(be('utils/inapp-personalization.ts'), 'export async function buildPreviewCustomers(')).toContain("getOwnerCustomerScopeSql(companyId, ownerUserId, '')");
    const em = be('routes/email.ts');
    expect(em).toContain('listCustomerGrades(companyId, resolveOwnerScope(req))');
    expect(em).toContain('previewCustomerRecipients(companyId, grades, resolveOwnerScope(req))');
    expect(em).toContain('buildPreviewCustomers(auth.companyId, auth.ownerId)');
    const dm = stripComments(be('routes/dm.ts'));
    expect(dm).not.toMatch(/selectSampleCustomers\(companyId\)/);
    expect(dm).not.toMatch(/selectSampleCustomerByKey\(companyId, sampleKey\)/);
  });
});

describe('⑤ ⑬ ⑮ DM 보내기', () => {
  const body = routeBody(be('routes/dm.ts'), "dmRouter.post('/:id/send-to-target'");
  it('접수되지 않은 시도의 토큰은 지운다(finally · 접수 표시 뒤에만 남는다)', () => {
    expect(body).toContain('let accepted = false;');
    expect(body.indexOf('accepted = true;')).toBeGreaterThan(body.indexOf('campaignId = result.campaignId;'));
    expect(body).toMatch(/finally \{\n\s+if \(!accepted\) \{\n\s+await discardDmRecipientTokens\(/);
  });
  it('겹친 두 번 누름 = 잠금 CT(같은 사람 · 같은 발송) · 직접발송 두 입구도', () => {
    expect(be('routes/dm.ts')).toContain("dmRouter.post('/:id/send-to-target', requireDmAccess, demoBlock, singleFlight('dm-send-to-target', async");
    const c = be('routes/campaigns.ts');
    expect(c).toContain("router.post('/direct-send', singleFlight('direct-send', async");
    expect(c).toContain("router.post('/direct-send/commit', singleFlight('direct-send-commit', async");
  });
  it('이미 발행된 DM 도 보낼 때 고객 화면 빈 자리 · 링크 · 채울 자리를 본다', () => {
    expect(body).toContain('const block = dm.short_code ? dmPublishStaticBlock(dm) : await dmPublishBlocker(dm);');
  });
  it('발행 관문이 고객 화면 글자(렌더 결과)를 본다 · 판정 = DM CT 한 곳', () => {
    const gate = be('utils/dm/dm-publish-gate.ts');
    expect(fnBody(gate, 'export function dmPublishStaticBlock(')).toContain('findDmPlaceholderResidue(renderDmViewerHtml(');
    expect(be('utils/planner-execution.ts')).not.toContain('const DM_PLACEHOLDER_LITERALS');
    expect(be('utils/dm/dm-placeholder-residue.ts')).toContain('const DM_PLACEHOLDER_LITERALS');
  });
  it('렌더러가 빈 값 자리에 찍는 글자는 판정 목록에 있다', async () => {
    const { findDmPlaceholderResidue } = await import('../dm/dm-placeholder-residue');
    const renderer = be('utils/dm/dm-section-renderer.ts');
    const literals = Array.from(renderer.matchAll(/(\[[^\]<>'"`$]{2,30}(?:추가|작성|입력)해주세요\]|이미지를 추가해주세요)/g)).map((m) => m[1]);
    expect(literals.length).toBeGreaterThan(3);
    for (const l of new Set(literals)) expect(findDmPlaceholderResidue(`<div>${l}</div>`).length, l).toBeGreaterThan(0);
  });
});

describe('⑮ 인앱 게시 = 공용 채울 자리 판정 · 저장(초안)은 옛 판정', () => {
  it('게시 관문이 findAiFillPlaceholder 를 본다 · 저장 판정(textHasPlaceholder)은 세 낱말 그대로(템플릿 안내 자리를 채우며 저장)', async () => {
    const im = be('utils/inapp-message.ts');
    expect(fnBody(im, 'export function inAppPublishDefect(')).toContain('const aiFill = findAiFillPlaceholder([');
    expect(fnBody(im, 'function textHasPlaceholder(')).not.toContain('AiFill');
    const { inAppPublishDefect } = await import('../inapp-message');
    const base = { title: '가을 신상', body: '이번 주 소식', template: 'center_modal', buttons: [], content_blocks: [] };
    expect(inAppPublishDefect(base)).toBeNull();
    expect(inAppPublishDefect({ ...base, content_blocks: [{ type: 'body', text: '[질문을 작성해주세요]' }] })?.field).toBe('placeholder');
    expect(inAppPublishDefect({ ...base, body: '[브랜드 소개를 작성해주세요]' })?.field).toBe('placeholder');
  });
});

describe('⑥ 예약 · 재발송 · 플래너 메일 = 즉시 발송과 같은 내용 잠금', () => {
  it('엔진 · 예약 워커가 emailContentBlocker(채울 자리 + 링크 결함)를 쓴다', () => {
    const engine = fnBody(be('utils/email-channel.ts'), 'async function sendEmailCampaignInner(');
    expect(engine).toContain('const contentBlock = emailContentBlocker(campaign);');
    expect(engine).not.toContain('hasUneditedPlaceholder(');
    const sw = be('utils/email-send-sweeper.ts');
    expect(sw).toContain('emailContentBlocker({ subject: row.subject, htmlBody: row.html_body, textBody: row.text_body })');
    expect(sw).not.toContain('hasUneditedPlaceholder(');
  });
  it('미오픈 재발송 = 자식 캠페인을 만들기 전에 보낼 모습(최종 제목 + 원본 본문)으로 같은 잠금(재발송 한도를 실패로 쓰지 않게 · Codex 1R)', () => {
    const em = be('routes/email.ts');
    const r = em.slice(em.indexOf("router.post('/campaigns/:id/resend-non-openers'"));
    const b = r.indexOf('const resendBlock = emailContentBlocker({');
    expect(b).toBeGreaterThan(-1);
    expect(b).toBeLessThan(r.indexOf("withKeyedLock('email-resend'"));
    expect(r.slice(b, b + 260)).toContain('htmlBody: parent.htmlBody, textBody: parent.textBody,');
  });
});

describe('⑦ 푸시 발송 · 인앱 변형 켜기 = 서버 요금제 문', () => {
  const cdp = be('routes/cdp.ts');
  it('푸시 발송 = 관리자 CT + aiZonePlanBlocked(발송 앞)', () => {
    const b = cdp.slice(cdp.indexOf("router.post('/push/send'"), cdp.indexOf('sendPushCampaign(', cdp.indexOf("router.post('/push/send'")));
    expect(b).toContain('if (resolveOwnerScope(req)) {');
    expect(b).toContain('if (await aiZonePlanBlocked(req, res)) return;');
  });
  it('변형 만들기 · 켜기 = 문 · 목록 · 끄기 = 문 밖', () => {
    expect(cdp).toContain("if ((action === 'create' || (action === 'set_status' && req.body?.status === 'active')) && (await aiZonePlanBlocked(req, res))) return;");
  });
});

describe('⑧ 한 줄 = 단계 한 길(옛 한 줄 갈래 삭제)', () => {
  it('세 채널 서버가 단계 없는 한 줄 요청을 400 으로 닫는다 · 옛 시도 토큰 돈 순서 0', () => {
    for (const f of ['routes/dm.ts', 'routes/email.ts', 'routes/cdp.ts']) {
      const s = stripComments(be(f));
      expect(s, f).toContain("code: 'LINE_STEPS_REQUIRED'");
      expect(s, f).not.toContain('buildOneLineIdempotencyKey(');
      expect(s, f).not.toContain('sanitizeLineFacts(');
    }
  });
  it('화면 — 공용 요청은 단계 답 필수 · 옛 묻는 창(DM · 이메일) 0', () => {
    expect(fe('utils/one-line.ts')).toMatch(/export interface LineDmRequest \{[\s\S]*?\n  steps: Record<string, unknown>;\n\}/);
    expect(fe('pages/DmBuilderPage.tsx')).not.toContain('LineFactsInline');
    expect(fe('pages/EmailCampaignsPage.tsx')).not.toContain('LineFactsAskModal');
    expect(fe('pages/QuickCampaignResultPage.tsx')).toContain("handoff?.origin?.kind === 'line' && handoff.origin.steps ? handoff.origin : null");
  });
});

describe('⑨ 인앱 추적 = 회원임을 증명한 요청만 회원에 잇는다', () => {
  it('세 공개 주소가 같은 판정', async () => {
    const cdp = be('routes/cdp.ts');
    expect(cdp.match(/isCdpMemberConfirmed\(req\.headers, cdpAuth\.companyId,/g)?.length).toBe(3);
    expect(stripComments(cdp)).not.toContain('verifyCdpMemberToken(');
    const { isCdpMemberConfirmed, issueCdpMemberToken } = await import('../cdp-member-token');
    const old = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-secret-for-member-token';
    try {
      const t = issueCdpMemberToken('c1', 'm1').token;
      expect(isCdpMemberConfirmed({}, 'c1', 'm1', t)).toBe(true);
      expect(isCdpMemberConfirmed({}, 'c1', 'm2', t)).toBe(false);
      expect(isCdpMemberConfirmed({}, 'c1', 'm1', undefined)).toBe(false);
      expect(isCdpMemberConfirmed({ 'x-hanjullo-secret': 's' }, 'c1', 'm1', undefined)).toBe(true);
      expect(isCdpMemberConfirmed({ 'x-hanjullo-secret': 's' }, 'c1', '', undefined)).toBe(false);
    } finally {
      process.env.JWT_SECRET = old;
    }
  });
  it('노출 판정이 기기 id 기록도 함께 센다(증명 없는 추적이 기기 id 로만 남아도 한 기기 동작 그대로) · 웹 SDK 가 토큰을 싣는다', () => {
    const ev = fnBody(be('utils/inapp-message.ts'), 'async function evaluateInAppCandidates(');
    expect(ev).toContain("AND (${seenConds.join(' OR ')})");
    expect(ev).toContain("AND (${limitConds.join(' OR ')})");
    expect(read(join(BE, '..', '..', 'sdk-js', 'src', 'inapp.ts'))).toContain('member_token: input.memberToken || undefined,');
  });
});

describe('⑩ 원문 오류 0 — DM 테스트 발송 · A/B', () => {
  it('받는 사람별 사유도 고객 글 · A/B 4xx 도 공용 CT', () => {
    const dm = stripComments(be('routes/dm.ts'));
    expect(dm).toContain("results.push({ phone, ok: false, error: publicErrorText(e, '적재하지 못했어요', 'DM 테스트발송') });");
    expect(dm).not.toContain("error: err.message || '생성 실패'");
    expect(dm).not.toContain("error: err.message || '수정 실패'");
  });
});

describe('⑪ 화면이 부르지 않는 DM 주소 삭제', () => {
  it('14개 주소가 없다', () => {
    const dm = stripComments(be('routes/dm.ts'));
    for (const r of ["'/ai/parse-prompt'", "'/ai/generate-copy'", "'/ai/transform-tone'", "'/:id/self-diagnose'", "'/:id/section-suggest'", "'/ai/recommend-layout'",
      "'/from-template'", "'/top-campaigns'", "'/ai/event-text-from-url'", "'/:id/request-approval'", "'/:id/approve'", "'/:id/reject'", "'/delete-image'", "'/:id/prizes'"]) {
      expect(dm, r).not.toMatch(new RegExp(`dmRouter\\.(?:get|post|put|delete)\\(${r.replace(/[/:]/g, (m) => '\\' + m)}`));
    }
  });
});

describe('⑫ A/B · 단축 링크 = 담당자 본인 것', () => {
  it('상세 · 고치기 · 시작 · 멈춤 · 종료 · 지우기에 가드 · 목록 · 끄기에 범위', () => {
    const dm = be('routes/dm.ts');
    for (const d of ["dmRouter.get('/ab-tests/:id', requireAbTestAccess,", "dmRouter.put('/ab-tests/:id', requireAbTestAccess,", "dmRouter.post('/ab-tests/:id/start', requireAbTestAccess,",
      "dmRouter.post('/ab-tests/:id/pause', requireAbTestAccess,", "dmRouter.post('/ab-tests/:id/complete', requireAbTestAccess,", "dmRouter.delete('/ab-tests/:id', requireAbTestAccess,"]) {
      expect(dm, d).toContain(d);
    }
    expect(dm).toContain('listAbTests(companyId, resolveOwnerScope(req))');
    expect(dm).toContain('listCustomShortLinks(companyId, resolveOwnerScope(req))');
    expect(dm).toContain('setCustomShortLinkActive(companyId, req.params.linkId, isActive, resolveOwnerScope(req))');
    expect(dm.match(/canAccessEveryDm\(\[/g)?.length).toBe(2);
  });
  it('A/B 목록 쿼리 = 자리 수와 인자 수가 같다(담당자 · 관리자 · Codex 1R)', async () => {
    const { listAbTests } = await import('../dm/dm-ab-test');
    queryMock.mockResolvedValue({ rows: [] });
    await listAbTests('c1', 'u1');
    await listAbTests('c1', null);
    for (const [sql, params] of queryMock.mock.calls) {
      const used = new Set(Array.from(String(sql).matchAll(/\$(\d+)/g), (m) => Number(m[1])));
      expect(params.length).toBe(Math.max(...used));
    }
    // ★ 1025 R12 #80 — 상한 + 1 을 읽어 잘림을 안다(LIMIT 자리 = 셋째 인자)
    expect(queryMock.mock.calls.map(([, p]) => p.slice(0, 2))).toEqual([['c1', 'u1'], ['c1', null]]);
    expect(queryMock.mock.calls.every(([sql]) => /ORDER BY created_at DESC LIMIT \$3/.test(String(sql)))).toBe(true);
  });
});

describe('⑬ 잠금 CT — 문구를 받는다(기본 = 옛 문구)', () => {
  it('둘째 요청 = 409 + 받은 문구', async () => {
    const { singleFlight, clearInflightForTest } = await import('../inflight-lock');
    clearInflightForTest();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const h = singleFlight('t-send', async () => { await gate; }, '보내는 중');
    const req = { user: { companyId: 'c', userId: 'u' } };
    const first = h(req, {});
    const res: any = { status: vi.fn(() => res), json: vi.fn() };
    await h(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: '보내는 중', code: 'IN_FLIGHT' }));
    release();
    await first;
  });
});

describe('⑯ 인앱 표시 = 거른 뒤 자른다', () => {
  it('후보를 쪽 단위로 읽으며 쪽마다 모든 거름 · 20개가 되거나 후보가 다할 때까지(Codex 1R)', () => {
    const v2 = fnBody(be('utils/inapp-message.ts'), 'export async function getActiveMessagesForCustomerV2(');
    expect(v2).not.toMatch(/LIMIT (20|200)`/);
    expect(stripComments(v2)).not.toContain('OFFSET');
    expect(v2).toContain('ORDER BY created_at DESC, id DESC');
    expect(v2).toContain('AND id = ANY($4::uuid[])`');
    expect(v2).toContain('shown.push(...(await evaluateInAppCandidates(input, trigger, customerId, pageRows)));');
  });
  it('첫 쪽이 전부 걸러져도 다음 쪽의 맞는 메시지를 보인다', async () => {
    const { getActiveMessagesForCustomerV2 } = await import('../inapp-message');
    const row = (i: number, audience: Record<string, unknown> | null) => ({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, title: `메시지 ${i}`, body: '본문', status: 'active', template: 'center_modal',
      trigger_event: 'page_load', trigger_conditions: { event: 'page_load' }, segment_conditions: {}, audience_filter: audience, allowed_weekdays: [0, 1, 2, 3, 4, 5, 6],
      send_start_hour: null, send_end_hour: null, display_frequency: 'always', parent_message_id: null, buttons: [], content_blocks: [],
    });
    // 표시 대상 조건이 있는데 고객을 모르면 빠진다 → 첫 쪽 50개 전부 빠짐 · 둘째 쪽 1개만 맞음
    const all = [...Array.from({ length: 50 }, (_, i) => row(i + 1, { grade: { operator: 'eq', value: 'VIP' } })), row(99, null)];
    let pageCalls = 0;
    queryMock.mockImplementation(async (sql: string, params: any[]) => {
      if (/^\s*SELECT id FROM cdp_inapp_messages/.test(sql)) return { rows: all.map((r) => ({ id: r.id })) };
      if (/AND id = ANY\(\$4::uuid\[\]\)/.test(sql)) {
        pageCalls++;
        // 첫 쪽을 읽는 동안 앞쪽 후보 하나가 꺼졌다(쪽 행 조회에서 빠짐) — 고정한 순서라 둘째 쪽의 맞는 메시지를 건너뛰지 않는다
        const ids = new Set(params[3] as string[]);
        return { rows: all.filter((r) => ids.has(r.id) && r.id !== all[2].id).reverse() };
      }
      return { rows: [] };
    });
    const out = await getActiveMessagesForCustomerV2({ companyId: 'c1', triggerEvent: 'page_load', channel: 'web', anonymousId: 'a1' } as any);
    expect(out.map((m: any) => m.title)).toEqual(['메시지 99']);
    expect(pageCalls).toBe(2);
  });
  it('쪽 행은 고정한 순서대로 · 같은 부모가 두 번 나오지 않는다', async () => {
    const { getActiveMessagesForCustomerV2 } = await import('../inapp-message');
    const mk = (i: number) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, title: `메시지 ${i}`, body: '본문', status: 'active', template: 'center_modal', trigger_event: 'page_load', trigger_conditions: { event: 'page_load' }, segment_conditions: {}, audience_filter: null, allowed_weekdays: [0, 1, 2, 3, 4, 5, 6], send_start_hour: null, send_end_hour: null, display_frequency: 'always', parent_message_id: null, buttons: [], content_blocks: [] });
    const all = [mk(3), mk(2), mk(1)];
    queryMock.mockImplementation(async (sql: string) => {
      if (/^\s*SELECT id FROM cdp_inapp_messages/.test(sql)) return { rows: all.map((r) => ({ id: r.id })) };
      if (/AND id = ANY\(\$4::uuid\[\]\)/.test(sql)) return { rows: [...all].reverse() };
      return { rows: [] };
    });
    const out = await getActiveMessagesForCustomerV2({ companyId: 'c1', triggerEvent: 'page_load', channel: 'web', anonymousId: 'a1' } as any);
    expect(out.map((m: any) => m.title)).toEqual(['메시지 3', '메시지 2', '메시지 1']);
  });
});
