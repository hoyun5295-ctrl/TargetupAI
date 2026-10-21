/**
 * create-noplan-account.ts — 미가입 전용 테스트 계정 noplan 만들기(★ 2026-10-21 Harold 지시)
 *
 * 왜: 미가입 회사 화면(잠김 · 요금제 안내)을 볼 때마다 테스트 계정 요금제를 미가입 ↔ 임직원으로 바꾸던 것을 없앤다.
 *
 * 하는 일:
 *   ① 점검 — FREE 요금제가 있는가 · 로그인 ID noplan 이 비었는가 · 회사 코드 NOPLAN 이 비었는가(있는데 이름이 다르면 멈춤).
 *      이미 있으면 덮어쓰지 않고 멈춘다. 점검은 비밀번호를 묻기 전에 한다.
 *   ② 비밀번호 — 서버 터미널에서 두 번 입력(화면에 안 보임 · 8자 이상 · 두 번 같아야). 명령어 · 쉘 기록 · 출력 어디에도 남지 않는다.
 *   ③ 회사 = 기존 CT createCompanyCore(요금제 FREE = 실제 미가입 고객과 같은 상태 · 게이트웨이 일괄 생성과 같은 길 ·
 *      요금제 이력 initial · 고객사 등록 기록 · 시스템 싱크 사용자 · 고객 코드 순번 = CT 가 같이 만든다).
 *      앞선 실행이 회사만 만들고 멈췄으면(같은 이름의 NOPLAN 회사) 그 회사를 그대로 쓴다.
 *   ④ 계정 = 기존 CT createCompanyAdminUser(관리자 · bcrypt · 발급 기록) · 첫 로그인 비밀번호 변경 강제는 끈다(서버에서 정한 비밀번호를 그대로 쓴다).
 *
 * 실행(운영 서버 · packages/backend · 터미널에서 직접):
 *   npx ts-node scripts/create-noplan-account.ts
 */
import 'dotenv/config';
import { query } from '../src/config/database';
import { createCompanyAdminUser, createCompanyCore } from '../src/utils/company-create';

const NOPLAN = {
  loginId: 'noplan',
  companyCode: 'NOPLAN',
  companyName: '미가입 테스트(noplan)',
  userName: '미가입 테스트',
} as const;

/** 두 번 입력한 비밀번호 판정 — 문제가 없으면 null */
function checkPassword(first: string, second: string): string | null {
  if (first.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (first !== second) return '두 번 입력한 비밀번호가 다릅니다.';
  return null;
}

/** 터미널에서 한 줄 입력 — 입력한 글자를 화면에 내보내지 않는다(Ctrl+C = 취소) */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { reject(new Error('터미널에서 직접 실행해 주세요(비밀번호를 화면 입력으로 받습니다).')); return; }
    process.stdout.write(prompt);
    let value = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { cleanup(); resolve(value); return; }
        if (ch === '\u0003') { cleanup(); reject(new Error('취소했습니다. 아무것도 만들지 않았습니다.')); return; }
        if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  // ① 점검 — 비밀번호를 묻기 전에 끝낸다(조건이 안 맞으면 아무것도 만들지 않는다)
  const free = await query(`SELECT id FROM plans WHERE plan_code = 'FREE' LIMIT 1`);
  const freePlanId: string | undefined = free.rows[0]?.id;
  if (!freePlanId) throw new Error("plans 에 plan_code='FREE' 가 없습니다. 아무것도 만들지 않았습니다.");

  const existingUser = await query(`SELECT id FROM users WHERE login_id = $1 LIMIT 1`, [NOPLAN.loginId]);
  if (existingUser.rows.length > 0) throw new Error(`로그인 ID ${NOPLAN.loginId} 계정이 이미 있습니다. 덮어쓰지 않고 멈춥니다.`);

  const existingCompany = await query(`SELECT id, company_name FROM companies WHERE company_code = $1 LIMIT 1`, [NOPLAN.companyCode]);
  if (existingCompany.rows.length > 0 && existingCompany.rows[0].company_name !== NOPLAN.companyName) throw new Error(
    `회사 코드 ${NOPLAN.companyCode} 를 다른 회사(${existingCompany.rows[0].company_name})가 쓰고 있습니다. 아무것도 만들지 않았습니다.`,
  );

  // ② 비밀번호 — 화면에 안 보이게 두 번
  const pw1 = await askHidden(`${NOPLAN.loginId} 비밀번호(8자 이상 · 화면에 안 보입니다): `);
  const pw2 = await askHidden('한 번 더 입력: ');
  const problem = checkPassword(pw1, pw2);
  if (problem) throw new Error(`${problem} 아무것도 만들지 않았습니다.`);

  // ③ 회사(요금제 FREE) — 앞선 실행이 회사만 만들고 멈췄으면 그 회사를 쓴다
  let companyId: string;
  if (existingCompany.rows.length > 0) {
    companyId = String(existingCompany.rows[0].id);
    console.log(`이미 있는 회사 ${NOPLAN.companyName} 를 씁니다(${companyId}).`);
  } else {
    const company = await createCompanyCore({
      companyCode: NOPLAN.companyCode,
      companyName: NOPLAN.companyName,
      planId: freePlanId,
      usageType: 'web',
      auditScript: 'create-noplan-account',
    });
    companyId = String(company.id);
    console.log(`회사를 만들었습니다: ${NOPLAN.companyName} · 요금제 FREE(미가입) · ${companyId}`);
  }

  // ④ 계정 — 첫 로그인 비밀번호 변경 강제는 끈다
  // ★2026-10-21 실사 준비 S2(D-01) — 서버 관리 스크립트 발급으로 남긴다
  const user = await createCompanyAdminUser(companyId, NOPLAN.loginId, pw1, NOPLAN.userName, { channel: 'script', script: 'create-noplan-account' });
  await query(`UPDATE users SET must_change_password = false WHERE id = $1`, [user.id]);
  console.log(`계정을 만들었습니다: 로그인 ID ${NOPLAN.loginId} · 관리자 · 방금 입력한 비밀번호로 로그인합니다.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('noplan 계정 만들기 실패:', err?.message || err);
  process.exit(1);
});
