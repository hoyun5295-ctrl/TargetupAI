/**
 * setup-demo-company.ts — 시연 회사 1회 세팅(★ 2026-10-09 · 설계서 docs/2026-10-09-demo-company-design.md §8)
 *
 * 하는 일(멱등 · 끊기면 같은 명령을 다시 치면 이어 간다):
 *   ① 회사 생성(공용 CT createCompanyCore) → is_demo · use_db_sync · 라인그룹 없음(발송 2차 벽) · 요금제 없음(청구 입력 0)
 *   ② 싱크 키 새 시크릿(서버에는 해시만) → **바로** 권한 600 파일(기본 ~/demo-sync.env)에 기록 · 화면 출력 0
 *   ③ 관리자 계정(공용 CT createCompanyAdminUser · must_change_password = 첫 로그인 변경 강제)
 *   ④ 기존 고객 3,000명 + 지난 1년 구매 이력(싱크 수집 경로 루프백 · 실행 중인 서버가 받는다 · 덜 들어갔으면 다시 보낸다)
 *   ⑤ 여정 3개(신규 가입 · 재구매 · 휴면 회수) 생성 · 고객 적재 뒤에 켠다(기존 고객이 환영 여정에 들어가지 않게)
 *   ⑥ 자동마케팅 1개(생일 · 매일 10시 · 직접 쓴 문안 = AI 문안 생성 0)
 *
 * 실행(운영 서버 · 새 코드 배포 + companies.is_demo ALTER 뒤 · 서버가 떠 있어야 한다):
 *   read -s DEMO_INIT_PASSWORD && export DEMO_INIT_PASSWORD
 *   cd packages/backend && npx ts-node scripts/setup-demo-company.ts
 *   unset DEMO_INIT_PASSWORD
 * 비밀번호는 ENV 로만 받는다(인자·출력·로그 0). 파일 두 줄을 서버 .env 에 옮기고 재기동하면 매일 합성 데이터 워커가 뜬다.
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { query } from '../src/config/database';
import { createCompanyCore, createCompanyAdminUser } from '../src/utils/company-create';
import { hashSecret } from '../src/utils/secret-hash';
import { createJourneyFromTemplate, type JourneyTemplateCode, type JourneyStepDefinition } from '../src/utils/journey-builder';
import { activateJourneyGuarded } from '../src/utils/journey-activation';
import { createOperator } from '../src/utils/continuous-operator';
import { pushDemoSeed, demoPhone, DEMO_SEED_CUSTOMERS, expectedSeedPurchaseCount } from '../src/utils/demo-data';

const LOGIN_ID = 'hanjulai';
const COMPANY_CODE = 'HANJULAIDEMO';
const COMPANY_NAME = '한줄 뷰티(시연)';
/** 여정 회신번호 = 도달 불가 번호(발송은 절단점에서 끝난다 · 화면 표시용) */
const DEMO_CALLBACK = demoPhone(9_999_999);

const JOURNEYS: Array<{ code: JourneyTemplateCode; name: string; steps: JourneyStepDefinition[] }> = [
  {
    code: 'onboarding', name: '신규 가입 환영',
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', isAd: true, subject: '가입을 환영합니다', messageTemplate: '%고객명%님, 한줄 뷰티 가입을 환영합니다.\n\n피부 타입에 맞는 첫 루틴을 매장과 온라인에서 함께 안내해 드릴게요.' },
      { stepOrder: 2, stepType: 'message', delayHours: 72, channel: 'lms', isAd: true, subject: '첫 루틴 추천', messageTemplate: '%고객명%님, 많이 찾으시는 수분 진정 토너와 히알루론 세럼으로 첫 루틴을 시작해 보세요.\n\n가까운 매장에서 테스트해 보실 수 있습니다.' },
    ],
  },
  {
    code: 'repeat', name: '구매 후 재구매 안내',
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 168, channel: 'lms', isAd: true, subject: '사용해 보니 어떠세요', messageTemplate: '%고객명%님, 최근 구매하신 제품은 잘 맞으셨나요?\n\n피부 고민이 있으시면 매장에서 편하게 상담받아 보세요.' },
      { stepOrder: 2, stepType: 'message', delayHours: 720, channel: 'lms', isAd: true, subject: '다시 채울 때가 됐어요', messageTemplate: '%고객명%님, 쓰시던 제품이 거의 다 떨어질 때쯤이에요.\n\n늘 쓰시던 제품으로 루틴을 이어 가 보세요.' },
    ],
  },
  {
    code: 'dormant', name: '휴면 고객 다시 만나기',
    steps: [
      { stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', isAd: true, subject: '오랜만이에요', messageTemplate: '%고객명%님, 오랜만에 인사드려요.\n\n새로 나온 시카 리페어 크림과 이번 시즌 추천 루틴을 소개해 드릴게요.' },
      { stepOrder: 2, stepType: 'message', delayHours: 168, channel: 'lms', isAd: true, subject: '이번 주 매장 소식', messageTemplate: '%고객명%님, 이번 주 매장에서 피부 상담 주간이 열려요.\n\n편하실 때 들러 주세요.' },
    ],
  },
];

async function main(): Promise<void> {
  const password = (process.env.DEMO_INIT_PASSWORD || '').trim();
  if (!password) throw new Error('DEMO_INIT_PASSWORD 가 없습니다(read -s 로 받아 export).');

  const col = await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'is_demo'`);
  if (col.rows.length === 0) throw new Error('companies.is_demo 칸이 없습니다. ALTER 를 먼저 실행해야 합니다.');

  // 싱크 키·시크릿 파일 — 회사를 만든 직후에 쓴다(Codex 1R medium · 뒤 단계가 끊겨도 다시 실행하면 이 파일로 이어 간다)
  const secretOut = process.env.DEMO_SECRET_OUT || path.join(os.homedir(), 'demo-sync.env');
  const readSecretFile = (): string | null => {
    try {
      const m = fs.readFileSync(secretOut, 'utf8').match(/^DEMO_SYNC_SECRET=([0-9a-f]+)$/m);
      return m ? m[1] : null;
    } catch { return null; }
  };

  // ① 회사 · ② 시크릿 · ③ 계정 — 단계마다 이어 간다(Codex 2R medium: 회사만 만들고 계정 전에 끊긴 경우도 같은 회사로)
  const existingUser = await query(`SELECT u.id AS user_id, u.company_id FROM users u WHERE u.login_id = $1`, [LOGIN_ID]);
  const existingCompany = existingUser.rows.length
    ? await query(`SELECT id, is_demo FROM companies WHERE id = $1::uuid`, [existingUser.rows[0].company_id])
    : await query(`SELECT id, is_demo FROM companies WHERE company_code = $1 LIMIT 1`, [COMPANY_CODE]);
  let companyId: string;
  let secretPlain: string | null = null;
  if (existingCompany.rows.length) {
    if (existingCompany.rows[0].is_demo !== true) throw new Error(`${LOGIN_ID} 계정 또는 회사 코드 ${COMPANY_CODE} 가 시연 회사가 아닌 회사에 있습니다. 중단합니다.`);
    companyId = String(existingCompany.rows[0].id);
    secretPlain = readSecretFile();
    console.log(`이미 있는 시연 회사를 씁니다: ${companyId}`);
  } else {
    const company = await createCompanyCore({ companyCode: COMPANY_CODE, companyName: COMPANY_NAME, dataInputMethod: 'sync', usageType: 'web' });
    companyId = String(company.id);
    secretPlain = crypto.randomBytes(32).toString('hex');
    await query(
      `UPDATE companies SET is_demo = true, use_db_sync = true, api_secret_hash = $2, api_secret = NULL WHERE id = $1::uuid`,
      [companyId, hashSecret(secretPlain)],
    );
    fs.writeFileSync(secretOut, `DEMO_SYNC_API_KEY=${String(company.api_key)}\nDEMO_SYNC_SECRET=${secretPlain}\n`, { mode: 0o600 });
    console.log(`시연 회사를 만들었습니다: ${companyId}`);
  }
  let userId: string;
  if (existingUser.rows.length) {
    userId = String(existingUser.rows[0].user_id);
  } else {
    const user = await createCompanyAdminUser(companyId, LOGIN_ID, password, '시연 관리자', { channel: 'super_admin' });
    userId = String(user.id);
    console.log(`관리자 계정을 만들었습니다: ${LOGIN_ID}`);
  }
  const keyRow = await query(`SELECT api_key FROM companies WHERE id = $1::uuid`, [companyId]);
  const apiKey = String(keyRow.rows[0].api_key);

  // ④ 고객 · 구매 이력 — 덜 들어갔으면 다시 보낸다(고객 = 번호 upsert · 구매 = 원장 고유 키 · 같은 시드라 같은 행)
  // 완료 판정 = 시드 구매 건수가 기대값에 닿았는가(일부 배치만 들어간 상태를 완료로 보지 않는다 · Codex 2R medium)
  const counts = await query(
    `SELECT (SELECT COUNT(*)::int FROM customers WHERE company_id = $1::uuid) AS customers,
            (SELECT COUNT(*)::int FROM purchases WHERE company_id = $1::uuid AND source_row_key LIKE 'demo-seed-%') AS purchases`,
    [companyId],
  );
  const needSeed = Number(counts.rows[0].customers) < DEMO_SEED_CUSTOMERS || Number(counts.rows[0].purchases) < expectedSeedPurchaseCount();
  if (needSeed) {
    if (!secretPlain) throw new Error(`고객 적재가 끝나지 않았는데 시크릿 파일(${secretOut})이 없습니다. 슈퍼관리자 화면에서 싱크 시크릿을 재발급해 그 파일에 넣고 다시 실행하세요.`);
    const seeded = await pushDemoSeed({ apiKey, apiSecret: secretPlain });
    console.log(`고객 ${seeded.customers}명 · 구매 ${seeded.purchases}건을 싱크 경로로 넣었습니다.`);
  }

  // ⑤ 여정 — 고객 적재 뒤에 켠다 · 만들었는데 켜기 전에 끊겼으면 이어서 켠다
  for (const j of JOURNEYS) {
    const has = await query(`SELECT id, status FROM journeys WHERE company_id = $1::uuid AND name = $2 LIMIT 1`, [companyId, j.name]);
    if (has.rows.length && has.rows[0].status === 'active') { console.log(`여정 켜져 있음: ${j.name}`); continue; }
    const journeyId: string = has.rows.length
      ? String(has.rows[0].id)
      : (await createJourneyFromTemplate({ companyId, createdBy: userId, templateCode: j.code, name: j.name, callbackNumber: DEMO_CALLBACK, steps: j.steps })).journeyId;
    // 문안 검증 표식 — 시연 회사는 스팸 검사(검사 발송)를 하지 않으므로 세팅 때 통과로 둔다
    // 한 번에 보낼 최대 인원 — 커서 경로가 아닌 트리거는 켜기 필수(journey-builder 켜기 검사) · 하루 합성분(수십 명)보다 넉넉히
    await query(
      `UPDATE journeys SET last_pretest_passed_at = NOW(), threshold_recipients_per_step = COALESCE(threshold_recipients_per_step, 500)
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [journeyId, companyId],
    );
    const act = await activateJourneyGuarded(companyId, journeyId, userId);
    console.log(`여정 ${act.ok === true ? '켬' : `켜기 실패(${'code' in act ? act.code : ''}: ${'message' in act ? act.message : ''})`}: ${j.name}`);
  }

  // ⑥ 생일 자동마케팅(같은 이름이 있으면 건너뛴다)
  const opName = '생일 축하 메시지';
  const hasOp = await query(`SELECT id FROM continuous_operators WHERE company_id = $1::uuid AND name = $2 LIMIT 1`, [companyId, opName]);
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
  console.log(`싱크 키·시크릿 파일: ${secretOut}(권한 600 · 화면 출력 0). 두 줄을 서버 .env 에 옮기고 재기동한 뒤 이 파일은 지우세요.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('시연 회사 세팅 실패:', err?.message || err);
  process.exit(1);
});
