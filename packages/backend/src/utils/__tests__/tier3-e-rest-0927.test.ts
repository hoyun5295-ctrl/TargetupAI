/**
 * 차수 3 ⑤ 남은 결함 (★ 2026-09-27 한줄로 V2) — CDP · JRN · INAPP · DM · AI · MAIL · XLSX · RCS · GW · ADMIN
 * 항목별 사유는 각 코드 주석(★ 2026-09-27 한줄로 V2 Rxxx)과 장부 §2-11 차수 3 기록.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const fe = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...p), 'utf8');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  if (i < 0) throw new Error(`못 찾음: ${a}`);
  const j = s.indexOf(b, i + a.length);
  return s.slice(i, j < 0 ? undefined : j);
};

describe('CDP', () => {
  it('R098 · R244 같은 몰이 여러 회사면 회사마다 기록·처리(카페24·아임웹·네이버 · 공용 CT)', () => {
    const ct = src('cdp-webhook-delivery.ts');
    expect(ct).toContain('export async function deliverWebhookToCompanies(');
    expect(ct).toContain('export function extractWebhookResource(');
    expect(src('cafe24-client.ts')).toContain('export async function getCafe24IntegrationsByMallId(');
    expect(src('imweb-client.ts')).toContain('export async function getImwebIntegrationsBySiteCode(');
    expect(src('naver-commerce-client.ts')).toContain('export async function getNaverCommerceIntegrationsByStoreId(');
    for (const f of ['cafe24.ts', 'imweb.ts', 'naver-commerce.ts']) {
      const r = src('..', 'routes', f);
      expect(r, f).toContain('await deliverWebhookToCompanies({');
      expect(r, f).not.toContain('INSERT INTO cdp_webhook_deliveries (\n        id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, created_at');
    }
    for (const f of ['cafe24-client.ts', 'imweb-client.ts', 'naver-commerce-client.ts']) {
      expect(src(f), f).not.toMatch(/AND mall_id = \$1 AND status = 'active'\s*LIMIT 1/);
    }
  });
  it('웹훅 본문 → 처리 대상(행동) — 원래 경로와 재처리가 같은 규칙(R188)', async () => {
    const { extractWebhookResource } = await import('../cdp-webhook-delivery');
    expect(extractWebhookResource('imweb', { data: { a: 1 }, resource: { b: 2 } })).toEqual({ a: 1 });
    expect(extractWebhookResource('imweb', { x: 1 })).toEqual({ x: 1 });
    expect(extractWebhookResource('cafe24', { resource: { b: 2 } })).toEqual({ b: 2 });
    expect(extractWebhookResource('cafe24', { x: 1 })).toEqual({});
    expect(extractWebhookResource('naver_smart_store', { x: 1 })).toEqual({ x: 1 });
    const w = src('cdp-webhook-retry-worker.ts');
    expect(w).toContain('const resource = extractWebhookResource(row.source, payload);');
  });
  it('R124 고도몰 백필 끝이 해제한 연동을 되살리지 않는다', () => {
    const g = src('godo-client.ts');
    const b = between(g, 'export async function backfillGodoOrders(', '\n}\n');
    expect(b).toContain("WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2 AND status <> 'revoked'");
  });
  it('R182 브라우저 SDK 이벤트도 고객 행 신호에 반영', () => {
    const e = src('cdp-events.ts');
    const b = between(e, 'export async function ingestBrowserEvents(', '\n}\n');
    expect(b).toContain('fusedEventNames.push(norm.eventName);');
    expect(b).toContain('await fuseEventToCustomer(companyId, customerId, name, occurred).catch(');
  });
  it('R186 30일 카운터 감쇠를 매일 돌린다 · R382 증분은 이어서', () => {
    const w = src('cdp-profile-recompute-worker.ts');
    expect(w).toContain('await decayInactiveCounters(row.company_id);');
    expect(w).toContain("WHERE occurred_at > NOW() - INTERVAL '60 days'");
    expect(w).toContain('let incrementalSince: Date | null = null;');
    expect(w).toContain('ORDER BY MAX(received_at) ASC');
  });
  it('R255 외부 ID → 고객 매핑이 출처를 본다', () => {
    const m = src('inapp-message.ts');
    const b = between(m, '// Step 2 — customer ID 매핑', '// Step 3');
    expect(b).toContain('AND source = $3');
  });
  it('R319 월 CDP 한도·사용량은 성공 호출만(두 읽기 같은 기준)', () => {
    expect(src('cdp-auth.ts')).toContain('AND COALESCE(status_code, 200) < 400');
    expect(src('..', 'routes', 'cdp.ts')).toContain('AND COALESCE(status_code, 200) < 400');
  });
});

describe('JRN', () => {
  it('m087 결과 안내는 표시 먼저(적재 실패면 되돌림)', () => {
    const w = src('campaign-sync-worker.ts');
    const b = between(w, "const lmsBody = [\n        '[여정 발송 결과]',", 'log(`✓ 여정 결과 LMS 발송');
    expect(b.indexOf('await markNotified(rows);')).toBeLessThan(b.indexOf('await bulkInsertSmsQueue('));
    expect(b).toContain('SET result_notified_at = NULL WHERE id = ANY($1::uuid[])');
  });
  it('R298 자동 재진입 켜기 = 운영 중 금지 · 사전검사 무효화', () => {
    const a = src('..', 'routes', 'ai.ts');
    const b = between(a, "router.patch('/operator/journeys/:id/auto-reentry'", '\nrouter.');
    expect(b).toContain('last_pretest_passed_at = CASE WHEN $3 THEN NULL ELSE last_pretest_passed_at END');
    expect(b).toContain("AND (NOT $3 OR status <> 'active')");
  });
  it('R424 진단 목표 = 실제 목표 칸 · 완주율 = 통계와 같은 값', () => {
    const d = src('journey-step-diagnosis.ts');
    expect(d).not.toContain("journey.objective || '재구매 유도'");
    expect(d).toContain('SELECT j.id, j.name, j.template_code, j.trigger_event, j.goal_kind,');
    expect(d).toContain('const completionRate = stats.overview.completionRate;');
  });
  it('R425 생일 = KST 날짜 · 2/29생은 평년 2/28', () => {
    const x = src('journey-target-extractor.ts');
    expect(x).not.toContain('CURRENT_DATE');
    expect(x).toContain("THEN '02-29' END");
    expect(src('stats-aggregation.ts')).toContain("export const KST_TODAY_DATE_SQL = `((NOW() AT TIME ZONE 'Asia/Seoul')::date)`;");
  });
  it('R428 블록 안 assign이 블록 밖에도 남는다(행동)', async () => {
    const { renderLiquid } = await import('../liquid-templating');
    const out = renderLiquid("{% assign flag = 'y' %}{% if flag == 'y' %}{% assign x = 'a' %}{% endif %}[{{ x }}]", {});
    expect(out.rendered).toBe('[a]');
    const loop = renderLiquid("{% assign n = 'z' %}{% for it in customer.items %}{{ it }}{% endfor %}[{{ n }}]", { customer: { items: ['1', '2'] } });
    expect(loop.rendered).toBe('12[z]');
  });
});

describe('INAPP', () => {
  it('R256 표준 표기(%고객등급%·%보유포인트%)도 브라우저 동봉 변수로 인식', async () => {
    const { extractUsedInAppVariables } = await import('../inapp-personalization');
    const used = extractUsedInAppVariables([{ title: '%고객등급% 회원님', body: '%보유포인트% 적립' }]);
    expect(used).toContain('grade');
    expect(used).toContain('points');
  });
  it('R415 메시지 CTR도 최근 30일(회사 평균과 같은 기간)', () => {
    const x = src('inapp-explainer.ts');
    expect(x).toContain("LEFT JOIN cdp_inapp_impressions i ON i.message_id = m.id AND i.company_id = m.company_id\n       AND i.occurred_at >= NOW() - INTERVAL '30 days'");
  });
});

describe('DM', () => {
  it('R119 수신자 토큰은 정제(중복·수신거부) 뒤 대상에게만', () => {
    const c = src('direct-send-core.ts');
    expect(c).toContain('export async function preFilterRecipientsLikeStaging<');
    const d = src('..', 'routes', 'dm.ts');
    expect(d.indexOf('recipients = await preFilterRecipientsLikeStaging(recipients, userId, isAd === true);')).toBeLessThan(d.indexOf('tokenPairs = await issueDmRecipientTokensBulk('));
  });
  it('R120 A/B 열람 비콘은 A/B 기록으로 · 방문 1회 = 1행', () => {
    const d = src('..', 'routes', 'dm.ts');
    const g = between(d, "dmPublicRouter.get('/ab/:code'", '\n});\n');
    expect(g).not.toContain('trackAbTestView(');
    expect(g).toContain(`html = html.split("TRACK_URL + '/' + CODE + '/track'").join(`);
    const v = src('dm', 'dm-viewer.ts');
    expect((v.match(/TRACK_URL \+ '\/' \+ CODE \+ '\/track'/g) || []).length).toBeGreaterThanOrEqual(2);
    const ab = src('dm', 'dm-ab-test.ts');
    const t = between(ab, 'export async function trackAbTestView(', '\n}\n');
    expect(t).toContain('WHERE ab_test_id = $1 AND dm_id = $2 AND anonymous_id = $3');
    expect(t).toContain('duration_seconds = duration_seconds + $3');
  });
  it('R210 비주얼 디렉터에 회사 브랜드 색 · R212 칼럼 확인 실패는 캐시하지 않음', () => {
    expect(src('dm', 'dm-ai.ts')).toContain('const concept = await designVisualConcept(spec, (brandKitRaw || undefined) as DmBrandKit | undefined, opts.companyId);');
    const k = src('dm', 'dm-brand-kit.ts');
    const b = between(k, 'async function ensureColumn(): Promise<boolean> {', '\n}\n');
    expect(b).not.toContain('columnExists = false;\n  }');
  });
  it('R399 복수 선택 해제 = 원래 색으로', () => {
    const v = src('dm', 'dm-viewer.ts');
    expect(v).toContain('var origBg = opt.style.background, origBorder = opt.style.borderColor;');
    expect(v).toContain("opt.style.background = origBg; opt.style.borderColor = origBorder;");
  });
});

describe('AI', () => {
  it('R072 브랜드 링크 라벨 -9까지 확인 · 다 차면 거절', () => {
    const m = src('..', 'routes', 'ai-memory.ts');
    expect(m).toContain('for (let suffix = 2; suffix <= 10; suffix++) {');
    expect(m).toContain('if (!labelResolved) {');
  });
  it('R075 한도 알림 발송 워커 · 앱 알림 = 사용량 화면 표시', () => {
    const w = src('ai-usage-threshold-alert.ts');
    expect(w).toContain('export async function runAiUsageThresholdAlerts(');
    expect(w).toContain("AND COALESCE(ai_usage_threshold_config->>'last_alerted_month', '') <> $2");
    expect(src('..', 'app.ts')).toContain('startAiUsageThresholdAlertWorker();');
    expect(fe('components', 'AiUsage', 'ThresholdAlertModal.tsx')).not.toContain('앱 내 알림 센터에 표시');
  });
  it('R084 예측 1클릭 목표 문장에 인원수 없음', () => {
    const a = src('..', 'routes', 'ai.ts');
    const b = between(a, "router.post('/operator/predictive/quick-action'", '\nrouter.');
    expect(b).not.toMatch(/\$\{targetCount\.toLocaleString\(\)\}명에게/);
  });
  it('R155 · R358 AI 매핑 = 호출 전 쿼터 선점(원자) · 실패·파싱 실패면 반납', () => {
    const m = src('ai-mapping.ts');
    expect(m).toContain('async function reserveQuota(');
    expect(m).toContain('AND COALESCE(ai_mapping_calls_month, 0) < $3');
    expect(m).toContain('await releaseQuota(companyId);');
    expect(m).not.toContain('await incrementQuota(companyId);');
  });
  it('R161 자연어 타겟 프롬프트에 오늘(KST)', () => {
    const g = src('ai-segment-generator.ts');
    expect(g).toContain('오늘(한국 시간) = ${kstDateString()}');
    expect(g).not.toContain('toISOString().slice(0, 10)');
  });
  it('R172 ❤️ 같은 허용 이모지는 위반이 아니다(행동)', async () => {
    const { validateBrandVoiceCompliance } = await import('../brand-voice-validator');
    const r = validateBrandVoiceCompliance('오늘도 감사합니다 ❤️', {
      frequent_expressions: [], emoji_whitelist: ['❤️'], forbidden_expressions: [], ending_style: 'any',
    } as any, { channel: 'LMS' });
    expect(r.issues.join(' ')).not.toContain('허용되지 않은 이모지');
  });
});

describe('MAIL · XLSX · RCS · GW', () => {
  it('R121 첫 오픈 판정 = 잠금 안에서(동시 오픈 누락·이중 계산 없음)', () => {
    const c = src('email-channel.ts');
    const b = between(c, 'export async function recordEmailEvent(', '\n}\n');
    expect(b).toContain('pg_advisory_xact_lock(hashtext($1))');
    expect(b).toContain("await client.query('COMMIT');");
  });
  it('R228 영구 거부(5xx)는 반송으로 기록', () => {
    expect(src('company-smtp-client.ts')).toContain('export function isPermanentSmtpRejection(');
    expect(src('email-channel.ts')).toContain('if (isPermanentSmtpRejection(sendErr)) {');
  });
  it('R371 거부 판정 = 주소 완전 일치(행동)', async () => {
    const { isRecipientRejected } = await import('../billing-recipients');
    expect(isRecipientRejected({ rejected: ['ba@x.com'] }, 'a@x.com')).toBe(false);
    expect(isRecipientRejected({ rejected: ['A@X.com'] }, 'a@x.com')).toBe(true);
    expect(isRecipientRejected({ rejected: ['"Kim" <a@x.com>'] }, 'a@x.com')).toBe(true);
  });
  it('R097 개별 정산서·거래내역서 메일 = 일괄발급과 같은 한줄로 양식(CT 하나)', async () => {
    const { renderBillingMailHtml } = await import('../invoice-confirm');
    const withConfirm = renderBillingMailHtml({ companyName: '테스트몰', periodLabel: '2026-09-01 ~ 2026-09-30', name: null, amount: 11000, viewUrl: 'https://example.invalid/v/x' });
    expect(withConfirm).toContain('거래내역서를 보내드립니다');
    expect(withConfirm).toContain('https://example.invalid/v/x');
    const noConfirm = renderBillingMailHtml({ companyName: '테스트몰', periodLabel: '2026-09-01 ~ 2026-09-30', name: '담당', amount: 11000, viewUrl: null });
    expect(noConfirm).not.toContain('아래 버튼을 눌러 주세요');
    const b = src('..', 'routes', 'billing.ts');
    expect(b).not.toContain('INVITO 정산');
    expect(b).not.toContain('[INVITO]');
    expect(b).not.toContain('본 메일은 INVITO 한줄로 시스템에서 자동 발송되었습니다.');
    expect((b.match(/renderBillingMailHtml\(\{/g) || []).length).toBe(2);
    expect(src('invoice-confirm.ts')).toContain('const html = renderBillingMailHtml({ companyName, periodLabel, name, amount, viewUrl });');
  });
  it('R143 멈춘 업로드는 중단으로 확정', () => {
    const u = src('..', 'routes', 'upload.ts');
    const b = between(u, "router.get('/progress/:fileId'", '\n});\n');
    expect(b).toContain("parsed.status === 'processing'");
    expect(b).toContain('UPLOAD_STALL_MS');
    expect((u.match(/heartbeatAt: new Date\(\)\.toISOString\(\),/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it('R108 RCS 템플릿 수정도 링크 결함 검사', () => {
    const c = src('..', 'routes', 'companies.ts');
    const b = between(c, "router.put('/rcs-templates/:id'", '\nrouter.');
    expect(b).toContain("code: 'LINK_DEFECT'");
  });
  it('R237 54 게이트 꺼짐이면 54 행을 뽑지 않는다', () => {
    const g = src('gateway-template-mapping-worker.ts');
    const b = between(g, 'export async function runPushPass(', '\n}\n');
    expect(b).toContain("AND ($2::boolean OR server <> '54')");
    expect(b.indexOf('const allow54 = isGateway54Enabled();')).toBeLessThan(b.indexOf('FROM gateway_template_mappings'));
  });
});

describe('ADMIN', () => {
  it('m037 스팸 테스트 상세에 과금 여부(무료 체험·무료 자동 구분)', () => {
    for (const f of ['admin.ts', 'manage-stats.ts']) {
      const r = src('..', 'routes', f);
      expect(r, f).toContain('billable: isSpamTestBillable(r.source),');
      expect(r, f).toContain('SELECT r.phone, r.carrier, r.message_type, r.result, t.source,');
    }
    expect(fe('components', 'manage', 'StatsTab.tsx')).toContain("t.billable === false ? ' · 무료' : ''");
  });
  it('R068 요금제 신청 승인 = 한 트랜잭션(행 잠금) · 반려 = 조건부(Codex 차수3 E 1R)', () => {
    const a = src('..', 'routes', 'admin.ts');
    const ap = between(a, "router.put('/plan-requests/:id/approve'", '\nrouter.');
    expect(ap).toContain("SELECT company_id, requested_plan_id, status, message FROM plan_requests WHERE id = $1 FOR UPDATE");
    expect(ap).toContain('await grantFreeTrial(request.company_id, 30, { client });');
    expect(ap.indexOf("SET status = 'approved'")).toBeLessThan(ap.indexOf("await client.query('COMMIT');"));
    expect(ap).not.toContain('releaseClaim');
    const rj = between(a, "router.put('/plan-requests/:id/reject'", '\n//');
    expect(rj).toContain("WHERE id = $3 AND status = 'pending'");
  });
  it('R154 6.2(Windows 8·Server 2012 비R2) = win-legacy(행동)', async () => {
    const { resolveBuildTierFromOsInfo } = await import('../agent-build-tiers');
    expect(resolveBuildTierFromOsInfo('win32 6.2.9200')).toBe('win-legacy');
    expect(resolveBuildTierFromOsInfo('win32 6.3.9600')).toBe('win-mid');
    expect(resolveBuildTierFromOsInfo('win32 6.1.7601')).toBe('win-legacy');
    expect(resolveBuildTierFromOsInfo('win32 10.0.19045')).toBe('win-modern');
  });
  it('R275 · R276 원격 설정 = 주기 두 키만 DB에서 병합 · 매핑은 받지 않음', () => {
    const s = src('..', 'routes', 'admin-sync.ts');
    const b = between(s, "router.put('/agents/:agentId/config'", '\nrouter.');
    expect(b).toContain("config = COALESCE(config, '{}'::jsonb) || $1::jsonb");
    expect(b).toContain('if (column_mapping !== undefined) {');
    expect(b).not.toContain('...currentConfig');
  });
  it('R277 릴리즈 등록 = exe 확인 뒤 · 해제와 등록은 한 트랜잭션', () => {
    const s = src('..', 'routes', 'admin-sync.ts');
    const b = between(s, "router.post('/releases'", '\nrouter.');
    expect(b).toContain('fs.existsSync(path.join(agentReleasesDir(), exeName))');
    expect(b).toContain("await client.query('BEGIN');");
    expect(src('..', 'routes', 'sync.ts')).toContain('const AGENT_RELEASES_DIR = agentReleasesDir();');
  });
  it('R278 소비처 없는 싱크 로그 라우트 제거', () => {
    expect(src('..', 'routes', 'admin-sync.ts')).not.toContain("router.get('/agents/:agentId/logs'");
  });
  it('R279 회선 상한 = 비우면 제한 없음 · 0·음수·비숫자는 거절(행동)', async () => {
    const { parseLineLimitInput } = await import('../sender-line-limit');
    expect(parseLineLimitInput('')).toEqual({ ok: true, value: null });
    expect(parseLineLimitInput(null)).toEqual({ ok: true, value: null });
    expect(parseLineLimitInput('3')).toEqual({ ok: true, value: 3 });
    expect(parseLineLimitInput('0')).toEqual({ ok: false });
    expect(parseLineLimitInput('-1')).toEqual({ ok: false });
    expect(parseLineLimitInput('abc')).toEqual({ ok: false });
    expect(src('..', 'routes', 'admin.ts')).not.toContain('const toLimit = (v: any): number | null => {');
  });
  it('R337 슈퍼관리자 판정 = userType', () => {
    expect(src('..', 'routes', 'mms-images.ts')).toContain("req.user.userType !== 'super_admin'");
  });
  it('R353 감사 기록의 before = 조치 전 상태', () => {
    expect(src('account-action.ts')).toContain('before: previousStatus ?? user.status,');
    expect(src('..', 'routes', 'admin.ts')).toContain('previousStatus: before.status,');
  });
});
