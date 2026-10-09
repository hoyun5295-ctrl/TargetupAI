/**
 * setup-demo-company.ts — 시연 회사 세팅(★ 2026-10-09 · 설계서 docs/2026-10-09-demo-company-design.md §8 · docs/2026-10-09-journey-crm-map-design.md §6)
 *
 * 하는 일(멱등 · 끊기면 같은 명령을 다시 치면 이어 간다):
 *   ⓪ (--rebuild) 옛 방식(v1 무작위 구매) 시연 회사가 hanjulai 를 쓰고 있으면 은퇴: 로그인 · 회사 코드 이름 바꿈(한 트랜잭션) → 세션 끊기 → 여정 멈춤 · 자동마케팅 보관
 *   ① 회사 생성(공용 CT createCompanyCore) → is_demo · use_db_sync · 라인그룹 없음(발송 2차 벽) · 요금제 없음(청구 입력 0)
 *   ② 싱크 키 새 시크릿 → **먼저** 권한 600 파일(기본 ~/demo-sync.env) → 그다음 서버에 해시(끊겨도 파일의 키가 이 회사 것이면 그 시크릿으로 이어 간다)
 *   ③ 관리자 계정(공용 CT createCompanyAdminUser · must_change_password = 첫 로그인 변경 강제) · 회신번호 1행(도달 불가 · 시드만 넣는다)
 *   ④ 기존 고객 3,000명 + 어제까지의 구매 타임라인(v2 · 싱크 수집 경로 루프백 · 실행 중인 서버가 받는다)
 *   ⑤ 여정 7개 — 간격은 AI 진단과 같은 실측 CT 를 이 회사 데이터로 돌린 값(표본 미달이면 진단과 같은 참고 간격) · 고정 문안(AI 0)
 *      가입 환영 3 · 첫 구매 감사 3 · 단골 재구매 2(첫 구매 고객 빼기) · 상품 다시 채우기 2개 · 휴면 2 · 돌아온 고객 1 → 받는 여정 먼저 켠다
 *   ⑥ 자동마케팅 1개(생일 · 매일 10시 · 직접 쓴 문안 = AI 문안 생성 0)
 *
 * 실행(운영 서버 · 새 코드 배포 뒤 · 서버가 떠 있어야 한다):
 *   read -s DEMO_INIT_PASSWORD && export DEMO_INIT_PASSWORD
 *   cd packages/backend && npx ts-node scripts/setup-demo-company.ts --rebuild
 *   unset DEMO_INIT_PASSWORD
 * 비밀번호는 ENV 로만 받는다(인자·출력·로그 0). 파일 두 줄을 서버 .env 에 옮기고 재기동하면 매일 합성 데이터 워커가 새 회사로 이어 간다.
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { query, pool } from '../src/config/database';
import { createCompanyCore, createCompanyAdminUser } from '../src/utils/company-create';
import { hashSecret } from '../src/utils/secret-hash';
import { createJourneyFromTemplate, type JourneyTemplateCode, type JourneyStepDefinition } from '../src/utils/journey-builder';
import { activateJourneysInOrder } from '../src/utils/journey-activation';
import { createOperator, archiveOperator } from '../src/utils/continuous-operator';
import { pauseJourney } from '../src/utils/journey-pause-handler';
import { invalidateCompanySessions } from '../src/utils/session-manager';
import { triggerTemplateCode } from '../src/utils/journey-trigger-capability';
import { buildJourneyDiagnosis, type FlowPlanItem } from '../src/utils/journey-opportunities';
import { loadProductCycles, listObservedProducts } from '../src/utils/journey-product';
import { pushDemoSeed, demoPhone, DEMO_SEED_CUSTOMERS, expectedSeedPurchaseCount, isV1DemoCompany, kstDate } from '../src/utils/demo-data';

const LOGIN_ID = 'hanjulai';
const COMPANY_CODE = 'HANJULAIDEMO';
const RETIRED_CODE_PREFIX = 'HJDEMO_';
const COMPANY_NAME = '한줄 뷰티(시연)';
/** 여정 · 자동마케팅 회신번호 = 도달 불가 번호(발송은 절단점에서 끝난다 · 화면 표시용) */
const DEMO_CALLBACK = demoPhone(9_999_999);
const REBUILD = process.argv.slice(2).includes('--rebuild');

const msg = (order: number, days: number, prevDays: number, subject: string, body: string): JourneyStepDefinition => ({
  stepOrder: order, stepType: 'message', delayHours: Math.max(0, days - prevDays) * 24, channel: 'lms', isAd: true, subject, messageTemplate: body,
});
/** 누적 일수 + 문안 → 칸(칸 사이 대기 = 앞 칸과의 차이). */
function stepsAt(days: number[], copy: Array<{ subject: string; body: string }>): JourneyStepDefinition[] {
  return copy.slice(0, days.length).map((c, i) => msg(i + 1, days[i], i === 0 ? 0 : days[i - 1], c.subject, c.body));
}

interface DemoJourney { name: string; triggerEvent: string; filters: Record<string, unknown>; steps: JourneyStepDefinition[] }

function flowJourneys(plan: FlowPlanItem[]): DemoJourney[] {
  const p = (ev: string) => plan.find((x) => x.triggerEvent === ev)!;
  const signup = p('customer.created');
  const first = p('purchase.first');
  const repeat = p('cdp.purchase');
  const dormant = p('customer.dormant');
  const back = p('customer.dormant_return');
  const dd = dormant.dormantDays ?? 30;
  return [
    {
      name: '신규 가입 환영', triggerEvent: 'customer.created', filters: {},
      steps: stepsAt(signup.daysFromStart, [
        { subject: '가입을 환영합니다', body: '%고객명%님, 한줄 뷰티 가입을 환영합니다.\n\n피부 타입에 맞는 첫 루틴을 매장과 온라인에서 함께 안내해 드릴게요.' },
        { subject: '첫 루틴 추천', body: '%고객명%님, 많이 찾으시는 수분 진정 토너와 데일리 선크림으로 첫 루틴을 시작해 보세요.\n\n가까운 매장에서 직접 발라 보실 수 있어요.' },
        { subject: '피부 상담 받아 보세요', body: '%고객명%님, 아직 어떤 제품이 맞을지 고민이시라면 매장에서 피부 상담을 받아 보세요.\n\n10분이면 지금 피부에 맞는 루틴을 찾아 드려요.' },
      ]),
    },
    {
      name: '첫 구매 감사', triggerEvent: 'purchase.first', filters: {},
      steps: stepsAt(first.daysFromStart, [
        { subject: '첫 구매 감사합니다', body: '%고객명%님, 한줄 뷰티의 첫 구매를 진심으로 감사드려요.\n\n처음 며칠은 소량으로 발라 보시고 피부 반응을 살펴 주세요.' },
        { subject: '잘 맞으셨나요', body: '%고객명%님, 쓰고 계신 제품은 잘 맞으셨나요?\n\n함께 쓰면 좋은 제품이 궁금하시면 매장에서 편하게 물어봐 주세요.' },
        { subject: '루틴을 이어 가세요', body: '%고객명%님, 처음 고르신 제품이 거의 다 떨어질 때쯤이에요.\n\n쓰시던 제품으로 루틴을 이어 가 보세요.' },
      ]),
    },
    {
      name: '단골 재구매', triggerEvent: 'cdp.purchase', filters: { exclude_first_purchase: true },
      steps: stepsAt(repeat.daysFromStart, [
        { subject: '다시 찾아 주셔서 감사해요', body: '%고객명%님, 다시 찾아 주셔서 감사해요.\n\n이번에 고르신 제품도 피부에 잘 맞기를 바랄게요.' },
        { subject: '다시 채울 때가 됐어요', body: '%고객명%님, 쓰시던 제품을 다시 채울 때가 됐어요.\n\n늘 쓰시던 제품으로 루틴을 이어 가 보세요.' },
      ]),
    },
    {
      name: '휴면 고객 다시 만나기', triggerEvent: 'customer.dormant', filters: { dormant_days: dd },
      steps: stepsAt(dormant.daysFromStart, [
        { subject: '오랜만이에요', body: '%고객명%님, 오랜만에 인사드려요.\n\n요즘 피부는 어떠세요? 이번 시즌 추천 루틴을 소개해 드릴게요.' },
        { subject: '이번 주 매장 소식', body: '%고객명%님, 이번 주 매장에서 피부 상담 주간이 열려요.\n\n편하실 때 들러 주세요.' },
      ]),
    },
    {
      name: '돌아온 고객 환영', triggerEvent: 'customer.dormant_return', filters: { dormant_days: dd },
      steps: stepsAt(back.daysFromStart, [
        { subject: '다시 만나 반가워요', body: '%고객명%님, 다시 찾아 주셔서 정말 반가워요.\n\n이번 구매도 피부에 잘 맞기를 바랄게요. 궁금한 점은 언제든 매장에 물어봐 주세요.' },
      ]),
    },
  ];
}

function productJourney(p: { key: string; name: string; medianDays: number }): DemoJourney {
  // 첫 문자 = 사용 기간 그대로(생성기 상품 규칙과 같다 · 회의론자 D5) · 둘째 = 일주일 뒤.
  return {
    name: `${p.name} 다시 채우기`, triggerEvent: 'purchase.product',
    filters: { product_keys: [p.key], product_names: [p.name], door: 'ledger' },
    steps: stepsAt([p.medianDays, p.medianDays + 7], [
      { subject: `${p.name} 다 쓰셨나요`, body: `%고객명%님, 쓰시던 ${p.name}이(가) 거의 다 떨어질 때쯤이에요.\n\n끊기지 않게 미리 채워 두세요.` },
      { subject: `${p.name} 다시 채우기`, body: `%고객명%님, ${p.name} 다시 채우실 때가 지났어요.\n\n가까운 매장이나 온라인에서 편하게 만나 보세요.` },
    ]),
  };
}

/** ⓪ 옛 방식 시연 회사 은퇴 — hanjulai 가 v1 회사에 있을 때만(데이터 기준 · 다시 쳐도 새 회사를 은퇴시키지 않는다 · 회의론자 E3). */
async function retireV1(): Promise<string | null> {
  const u = await query(
    `SELECT u.id AS user_id, u.company_id, c.is_demo FROM users u JOIN companies c ON c.id = u.company_id WHERE u.login_id = $1`,
    [LOGIN_ID],
  );
  if (u.rows.length === 0) return null;
  const companyId = String(u.rows[0].company_id);
  if (u.rows[0].is_demo !== true) throw new Error(`${LOGIN_ID} 계정이 시연 회사가 아닌 회사에 있습니다. 중단합니다.`);
  if (!(await isV1DemoCompany(companyId))) return null;
  if (!REBUILD) throw new Error('옛 방식으로 만든 시연 회사가 hanjulai 를 쓰고 있습니다. --rebuild 를 붙여 실행하면 옛 회사를 은퇴시키고 새로 만듭니다.');
  const tag = companyId.replace(/-/g, '').slice(0, 6);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const a = await client.query(`UPDATE users SET login_id = $3 WHERE id = $1::uuid AND login_id = $2`, [u.rows[0].user_id, LOGIN_ID, `${LOGIN_ID}_${tag}`]);
    const b = await client.query(`UPDATE companies SET company_code = $2 WHERE id = $1::uuid AND is_demo = true`, [companyId, `${RETIRED_CODE_PREFIX}${tag}`]);
    const left = await client.query(`SELECT COUNT(*)::int AS n FROM users WHERE login_id = $1`, [LOGIN_ID]);
    if (a.rowCount !== 1 || b.rowCount !== 1 || Number(left.rows[0].n) !== 0) throw new Error('옛 시연 회사 이름 바꾸기가 한 행씩 되지 않아 되돌렸습니다.');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  console.log(`옛 시연 회사를 은퇴시켰습니다: ${companyId} (로그인 ${LOGIN_ID}_${tag})`);
  return companyId;
}

/** ②③ 은퇴한 시연 회사 정리 — 세션 끊기 · 여정 멈춤 · 자동마케팅 보관(예약 제안 취소) · 매번 다시 돌려도 같은 결과. */
async function quietRetired(): Promise<void> {
  const r = await query(`SELECT id FROM companies WHERE is_demo = true AND company_code LIKE $1`, [`${RETIRED_CODE_PREFIX}%`]);
  for (const row of r.rows) {
    const cid = String(row.id);
    await invalidateCompanySessions(cid);
    const js = await query(`SELECT id FROM journeys WHERE company_id = $1::uuid AND status = 'active'`, [cid]);
    for (const j of js.rows) await pauseJourney(String(j.id), '시연 회사 은퇴(새 시연 회사로 다시 만듦)');
    const ops = await query(`SELECT id FROM continuous_operators WHERE company_id = $1::uuid AND status <> 'archived'`, [cid]);
    for (const o of ops.rows) await archiveOperator(cid, String(o.id));
    if (js.rows.length || ops.rows.length) console.log(`은퇴한 시연 회사 정리: 여정 ${js.rows.length}개 멈춤 · 자동마케팅 ${ops.rows.length}개 보관`);
  }
}

async function main(): Promise<void> {
  const password = (process.env.DEMO_INIT_PASSWORD || '').trim();
  if (!password) throw new Error('DEMO_INIT_PASSWORD 가 없습니다(read -s 로 받아 export).');

  const col = await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'is_demo'`);
  if (col.rows.length === 0) throw new Error('companies.is_demo 칸이 없습니다. ALTER 를 먼저 실행해야 합니다.');

  await retireV1();
  await quietRetired();

  const secretOut = process.env.DEMO_SECRET_OUT || path.join(os.homedir(), 'demo-sync.env');
  /** 파일의 키 줄이 이 회사 키와 같을 때만 그 시크릿을 쓴다(옛 회사 파일을 새 회사에 쓰면 401 · 회의론자 E5). */
  const readSecretFor = (apiKey: string): string | null => {
    try {
      const text = fs.readFileSync(secretOut, 'utf8');
      const k = text.match(/^DEMO_SYNC_API_KEY=(.+)$/m);
      const s = text.match(/^DEMO_SYNC_SECRET=([0-9a-f]+)$/m);
      return k && s && k[1].trim() === apiKey ? s[1] : null;
    } catch { return null; }
  };

  // ① 회사 · ② 시크릿
  const existingUser = await query(`SELECT u.id AS user_id, u.company_id FROM users u WHERE u.login_id = $1`, [LOGIN_ID]);
  const existingCompany = existingUser.rows.length
    ? await query(`SELECT id, is_demo, api_key FROM companies WHERE id = $1::uuid`, [existingUser.rows[0].company_id])
    : await query(`SELECT id, is_demo, api_key FROM companies WHERE company_code = $1 LIMIT 1`, [COMPANY_CODE]);
  let companyId: string;
  let apiKey: string;
  if (existingCompany.rows.length) {
    companyId = String(existingCompany.rows[0].id);
    apiKey = String(existingCompany.rows[0].api_key);
    if (existingCompany.rows[0].is_demo !== true) {
      // 회사를 만든 직후 시연 표식 전에 끊긴 경우만 이어받는다 — 우리 회사 코드 + 사용자 · 고객 · 구매 0(Codex 1R medium).
      //   그 밖의 비시연 회사는 절대 건드리지 않는다.
      const empty = await query(
        // 회사 생성 함수가 함께 만드는 시스템 싱크 계정(is_system · system_sync_<회사 id>) 하나만 빼고 센다(Codex 2R).
        `SELECT (SELECT COUNT(*)::int FROM users WHERE company_id = $1::uuid
                  AND NOT (is_system = true AND login_id = 'system_sync_' || $1::text)) AS u,
                (SELECT COUNT(*)::int FROM customers WHERE company_id = $1::uuid) AS c,
                (SELECT COUNT(*)::int FROM purchases WHERE company_id = $1::uuid) AS p,
                (SELECT company_code FROM companies WHERE id = $1::uuid) AS code`,
        [companyId],
      );
      const e = empty.rows[0];
      if (existingUser.rows.length || e.code !== COMPANY_CODE || Number(e.u) + Number(e.c) + Number(e.p) > 0) {
        throw new Error(`${LOGIN_ID} 계정 또는 회사 코드 ${COMPANY_CODE} 가 시연 회사가 아닌 회사에 있습니다. 중단합니다.`);
      }
      await query(`UPDATE companies SET is_demo = true, use_db_sync = true WHERE id = $1::uuid AND company_code = $2`, [companyId, COMPANY_CODE]);
      console.log(`만들다 끊긴 빈 시연 회사를 이어받습니다: ${companyId}`);
    } else {
      console.log(`이미 있는 시연 회사를 씁니다: ${companyId}`);
    }
  } else {
    const company = await createCompanyCore({ companyCode: COMPANY_CODE, companyName: COMPANY_NAME, dataInputMethod: 'sync', usageType: 'web' });
    companyId = String(company.id);
    apiKey = String(company.api_key);
    // 시연 표식을 가장 먼저(이 사이에 끊겨도 위 "빈 회사 이어받기"가 받는다).
    await query(`UPDATE companies SET is_demo = true, use_db_sync = true WHERE id = $1::uuid`, [companyId]);
    console.log(`시연 회사를 만들었습니다: ${companyId}`);
  }
  // ② 시크릿 — 이 회사 키의 파일이 있으면 그 시크릿으로 해시를 다시 맞추고(파일 → 해시 사이에 끊긴 경우),
  //   없으면 새로 발급한다: 파일 먼저(권한 600) → 해시. 새로 발급하면 옛 시크릿은 무효(.env 는 이 파일 두 줄로 바꾼다).
  let secretPlain = readSecretFor(apiKey);
  if (!secretPlain) {
    secretPlain = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretOut, `DEMO_SYNC_API_KEY=${apiKey}\nDEMO_SYNC_SECRET=${secretPlain}\n`, { mode: 0o600 });
    console.log('싱크 시크릿을 새로 발급해 파일에 적었습니다.');
  }
  await query(`UPDATE companies SET api_secret_hash = $2, api_secret = NULL WHERE id = $1::uuid AND is_demo = true`, [companyId, hashSecret(secretPlain)]);

  // ③ 계정 · 회신번호
  let userId: string;
  if (existingUser.rows.length) {
    userId = String(existingUser.rows[0].user_id);
  } else {
    const user = await createCompanyAdminUser(companyId, LOGIN_ID, password, '시연 관리자', { channel: 'super_admin' });
    userId = String(user.id);
    console.log(`관리자 계정을 만들었습니다: ${LOGIN_ID}`);
  }
  // 회신번호 1행 — 시드만 넣는다(사람 입구 = 시연이면 거절 그대로 · 발송 0 = 큐 적재 CT 최후 방어). 없으면 화면의 초안 만들기가 막힌다.
  await query(
    `INSERT INTO callback_numbers (company_id, phone, label, is_default)
     SELECT $1::uuid, $2, '시연 · 발송 안 됨', true
      WHERE NOT EXISTS (SELECT 1 FROM callback_numbers WHERE company_id = $1::uuid)`,
    [companyId, DEMO_CALLBACK],
  );

  // ④ 고객 · 구매 타임라인 — 완료 판정 = v2 구매 건수가 그날 기대값에 닿았는가(덜 들어갔으면 다시 보낸다 · 같은 키라 이중 적재 0)
  const now = new Date();
  const today = kstDate(now);
  const counts = await query(
    `SELECT (SELECT COUNT(*)::int FROM customers WHERE company_id = $1::uuid) AS customers,
            (SELECT COUNT(*)::int FROM purchases WHERE company_id = $1::uuid AND source_row_key LIKE 'demo-v2-%') AS purchases`,
    [companyId],
  );
  if (Number(counts.rows[0].customers) < DEMO_SEED_CUSTOMERS || Number(counts.rows[0].purchases) < expectedSeedPurchaseCount(today)) {
    const seeded = await pushDemoSeed({ apiKey, apiSecret: secretPlain }, now);
    console.log(`고객 ${seeded.customers}명 · 구매 ${seeded.purchases}건을 싱크 경로로 넣었습니다.`);
  }

  // ⑤ 여정 7 — 간격 = AI 진단 실측 CT(이 회사 데이터) · 상품 = 관측 목록 상위(같은 키 규칙 · 대조 실패면 중단)
  const diagnosis = await buildJourneyDiagnosis(companyId);
  const observed = new Set((await listObservedProducts(companyId, 'ledger')).products.map((p) => p.key));
  const products = (await loadProductCycles(companyId, 'ledger', 2)).filter((p) => observed.has(p.key));
  if (products.length < 2) throw new Error(`다시 많이 사는 상품이 ${products.length}개뿐입니다(표본 부족). 구매 적재를 확인한 뒤 다시 실행하세요.`);
  for (const pl of diagnosis.flowPlan) {
    console.log(`간격 ${pl.title}: ${pl.daysFromStart.map((d) => `D+${d}`).join(' · ')}${pl.dormantDays ? ` · 휴면 ${pl.dormantDays}일` : ''}${pl.measured ? ' (실측)' : ' (참고)'}`);
  }
  const plan: DemoJourney[] = [...flowJourneys(diagnosis.flowPlan), ...products.map(productJourney)];
  const toActivate: string[] = [];
  for (const j of plan) {
    const has = await query(`SELECT id, status FROM journeys WHERE company_id = $1::uuid AND name = $2 AND archived_at IS NULL LIMIT 1`, [companyId, j.name]);
    if (has.rows.length && has.rows[0].status === 'active') { console.log(`여정 켜져 있음: ${j.name}`); continue; }
    const journeyId: string = has.rows.length
      ? String(has.rows[0].id)
      : (await createJourneyFromTemplate({
        companyId, createdBy: userId, name: j.name,
        templateCode: (triggerTemplateCode(j.triggerEvent) || 'custom') as JourneyTemplateCode,
        triggerEvent: j.triggerEvent, triggerFilters: j.filters,
        callbackNumber: DEMO_CALLBACK, steps: j.steps, thresholdRecipients: 500,
      })).journeyId;
    // 문안 검증 표식 — 시연 회사는 스팸 검사(검사 발송)를 하지 않으므로 세팅 때 통과로 둔다 · 한 번에 보낼 최대 인원(켜기 필수)
    await query(
      `UPDATE journeys SET last_pretest_passed_at = NOW(), threshold_recipients_per_step = COALESCE(threshold_recipients_per_step, 500)
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [journeyId, companyId],
    );
    toActivate.push(journeyId);
  }
  if (toActivate.length > 0) {
    const out = await activateJourneysInOrder(companyId, userId, toActivate);
    if (!out.ok) throw new Error(`여정을 켜지 못했습니다: ${out.message}`);
    for (const it of out.items) {
      console.log(`여정 ${it.result.ok ? '켬' : `켜기 실패(${'code' in it.result ? it.result.code : ''}: ${'message' in it.result ? it.result.message : ''})`}: ${it.name}`);
    }
  }

  // ⑥ 생일 자동마케팅(같은 이름이 있으면 건너뛴다)
  const opName = '생일 축하 메시지';
  const hasOp = await query(`SELECT id FROM continuous_operators WHERE company_id = $1::uuid AND name = $2 AND status <> 'archived' LIMIT 1`, [companyId, opName]);
  if (hasOp.rows.length) {
    console.log(`자동마케팅 있음: ${opName}`);
  } else {
    await createOperator({
      companyId, createdBy: userId, name: opName,
      objective: '오늘 생일인 고객에게 축하 메시지를 보낸다',
      schedule: 'daily', scheduleTime: '10:00', channel: 'lms',
      segmentKey: 'birthday',
      copyMode: 'fixed',
      fixedCopy: { subject: '생일 축하드려요', body: '%고객명%님, 생일을 진심으로 축하드려요.\n\n오늘 하루 가장 빛나는 하루 보내세요. 한줄 뷰티가 함께 축하합니다.' },
      callback: { callbackNumber: DEMO_CALLBACK, useIndividualCallback: false },
    });
    console.log(`자동마케팅 만듦: ${opName}`);
  }

  console.log('\n── 세팅 결과 ──');
  console.log(`회사 id: ${companyId}`);
  console.log(`로그인 아이디: ${LOGIN_ID} (첫 로그인 때 비밀번호 변경)`);
  console.log(`싱크 키·시크릿 파일: ${secretOut}(권한 600 · 화면 출력 0). 두 줄을 서버 .env 의 DEMO_SYNC_ 두 줄과 바꾸고 재기동한 뒤 이 파일은 지우세요.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('시연 회사 세팅 실패:', err?.message || err);
  process.exit(1);
});
