/**
 * backfill-industry.ts — companies.industry_code + ai_training_logs.industry_code 일괄 채움 (1회성)
 *
 * 실행(운영 서버, 적재 시와 동일 HMAC 키 필요):
 *   cd packages/backend && npx ts-node scripts/backfill-industry.ts
 *
 * 회사명 → 표준 업종 코드 매핑(Harold 2026-06-27 확정). 회사명은 공백 제거 후 매칭(미스매치 = skip + 로그).
 * 제외(자사·테스트·계약종료·미발송, 매핑에서 빠짐 → 미매칭 로그에 나타남):
 *   인비토 / 주식회사 인비토 / 마트테스트 / 디버깅테스트 / 테스트계정2 / KCP테스트 / KISA 테스트_1 /
 *   패밀리투 / 한국마사회 / 주식회사 페이지.
 */
import 'dotenv/config';
import pool from '../src/config/database';
import { getTenantRef } from '../src/utils/training-logger';
import { isIndustryCode } from '../src/utils/industry-codes';

const BY_CODE: Record<string, string[]> = {
  beauty: ['라프레리', '바닐라코', '스킨큐어', '시세이도', '(주) 한국시세이도', '폴라초이스코리아',
    '아우구스티누스 바더', '(주)고운세상코스메틱', '(주)맨담코리아', '라벨영화장품', 'toun28',
    '태영_엘렌실라', '라무르코리아', '주식회사 자연인', '미구하라_대행', '(주)에이엠커머스', '리스킨_대행'],
  fashion: ['나인', '쇼메', '베네통', '아르뉴', '금강제화', '아이디룩', '제시뉴욕', '게스코리아',
    '메트로시티', '송지오옴므', '크로커다일', '마리오아울렛', '이새에프앤씨', '디에스패션컴퍼니',
    '유한회사 벨루티코리아', '캣츠팩토리', '에프앤드에이', '코넥스솔루션', '크리에이션엘',
    '주식회사 비알케이컴퍼니', '수스_대행', '주식회사 우림에프엠지'],
  health: ['동국제약', '에이치피오_덴프스', '콤비타코리아'],
  food: ['강복자식품', '주식회사 테크푸드', '(주)경희 크리스피바바', '지삼유통'],
  edu: ['엔에스비', '최선어학원', '캐럿글로벌', '금정이지어학원', '숭실원격평생교육원',
    '방통대 미디어영상학과', '방통대 통계 데이터과학과'],
  travel: ['아난티', '무주덕유산리조트'],
  sports: ['벤제프', '에브리치', '트렉스타', '룰루레몬애틀라티카코리아유한회사',
    '자이언트골프앤투어_광주점', '주식회사 중평알앤에스'],
  finance: ['토스페이먼츠'],
  home: ['이폴리움', '에이스하드웨어'],
  baby: ['주식회사 베이컨'],
  service: ['마트스마트'],
};

function normName(s: string): string {
  return (s || '').replace(/\s+/g, '').trim();
}

const NAME_TO_CODE = new Map<string, string>();
for (const [code, names] of Object.entries(BY_CODE)) {
  if (!isIndustryCode(code)) throw new Error(`알 수 없는 업종 코드: ${code}`);
  for (const n of names) NAME_TO_CODE.set(normName(n), code);
}

async function main(): Promise<void> {
  const companies = await pool.query('SELECT id, name FROM companies');
  let companyUpdated = 0;
  const unmatched: string[] = [];

  // 1) companies.industry_code 채움 (회사명 매칭)
  for (const row of companies.rows as Array<{ id: string; name: string }>) {
    const code = NAME_TO_CODE.get(normName(row.name));
    if (!code) {
      unmatched.push(row.name);
      continue;
    }
    await pool.query('UPDATE companies SET industry_code = $1 WHERE id = $2', [code, row.id]);
    companyUpdated++;
  }
  console.log(`[1] companies 업종 채움: ${companyUpdated}건 / 미매칭(제외 포함): ${unmatched.length}건`);
  console.log('    미매칭 목록:', unmatched.join(', '));

  // 2) ai_training_logs backfill (tenant_ref = hmacHash(company_id) — 적재 시와 동일 키)
  const filled = await pool.query(
    "SELECT id, industry_code FROM companies WHERE industry_code IS NOT NULL AND industry_code <> ''",
  );
  let logUpdated = 0;
  for (const row of filled.rows as Array<{ id: string; industry_code: string }>) {
    const tenantRef = getTenantRef(row.id);
    const r = await pool.query(
      "UPDATE ai_training_logs SET industry_code = $1 WHERE tenant_ref = $2 AND (industry_code IS NULL OR industry_code = '')",
      [row.industry_code, tenantRef],
    );
    if (r.rowCount && r.rowCount > 0) logUpdated += r.rowCount;
  }
  console.log(`[2] ai_training_logs 업종 backfill: ${logUpdated}건`);

  await pool.end();
}

main().catch((e) => {
  console.error('[backfill-industry] 실패:', e);
  process.exit(1);
});
