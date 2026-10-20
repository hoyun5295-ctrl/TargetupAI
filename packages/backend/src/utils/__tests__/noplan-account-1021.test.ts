/**
 * ★ 2026-10-21 미가입 전용 테스트 계정 noplan (Harold 「테스트 계정을 미가입 ↔ 임직원으로 매번 바꾸기 불편 · 미가입 전용 계정 하나」)
 *
 * 처방 계약(scripts/create-noplan-account.ts · 원문 검사 — 스크립트 시험 선례 synthetic-test-company-1020 과 같은 방식):
 *   ① 회사 · 계정 생성 = 기존 CT(createCompanyCore · createCompanyAdminUser) · 요금제 = FREE(게이트웨이 일괄 생성과 같은 길)
 *   ② 점검(FREE 요금제 · noplan 계정 · NOPLAN 회사)을 비밀번호 입력 전에 · 이미 있으면 덮어쓰지 않고 멈춘다
 *   ③ 비밀번호 = 서버 터미널에서 화면에 안 보이게 두 번 · 8자 이상 · 같아야 · 어디에도 출력하지 않는다
 *   ④ 첫 로그인 비밀번호 변경 강제는 끈다(서버에서 정한 비밀번호를 그대로 쓴다)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '../../../scripts/create-noplan-account.ts'), 'utf-8');

describe('미가입 전용 계정 noplan 스크립트', () => {
  it('① 회사 · 계정은 기존 CT 로만 만든다(직접 INSERT 0) · 요금제 = FREE', () => {
    expect(SRC).toMatch(/import \{ createCompanyAdminUser, createCompanyCore \} from '\.\.\/src\/utils\/company-create';/);
    expect(SRC).not.toMatch(/INSERT INTO (companies|users)\b/);
    expect(SRC).toMatch(/SELECT id FROM plans WHERE plan_code = 'FREE' LIMIT 1/);
    expect(SRC).toMatch(/createCompanyCore\(\{[^}]*planId: freePlanId/);
    expect(SRC).toMatch(/loginId: 'noplan'/);
    expect(SRC).toMatch(/companyCode: 'NOPLAN'/);
  });

  it('② 점검이 비밀번호 입력보다 먼저 · 계정이 있으면 멈춤 · 같은 이름이 아닌 NOPLAN 회사가 있으면 멈춤', () => {
    const iFree = SRC.indexOf("plan_code = 'FREE'");
    const iUser = SRC.indexOf('SELECT id FROM users WHERE login_id = $1');
    const iCompany = SRC.indexOf('FROM companies WHERE company_code = $1');
    const iAsk = SRC.indexOf('await askHidden(');
    expect(iFree).toBeGreaterThan(-1);
    expect(iUser).toBeGreaterThan(iFree);
    expect(iCompany).toBeGreaterThan(iUser);
    expect(iAsk).toBeGreaterThan(iCompany);
    expect(SRC).toMatch(/if \(existingUser\.rows\.length > 0\) throw new Error\(/);
    expect(SRC).toMatch(/existingCompany\.rows\[0\]\.company_name !== NOPLAN\.companyName\) throw new Error\(/);
  });

  it('③ 비밀번호 = 터미널에서만 · 화면에 안 보임 · 8자 이상 · 두 번 같아야 · 출력 0', () => {
    expect(SRC).toMatch(/if \(!stdin\.isTTY\) \{ reject\(/);
    expect(SRC).toMatch(/stdin\.setRawMode\(true\)/);
    expect(SRC).toMatch(/if \(first\.length < 8\) return /);
    expect(SRC).toMatch(/if \(first !== second\) return /);
    // 입력값을 담은 변수가 출력 · 오류 문장에 들어가지 않는다
    expect(SRC).not.toMatch(/console\.(log|error)\([^;]*\b(pw1|pw2|password|buf)\b/);
    expect(SRC).not.toMatch(/process\.stdout\.write\([^;]*\b(pw1|pw2|buf|ch)\b/);
  });

  it('④ 첫 로그인 비밀번호 변경 강제를 끈다 · 발급 기록 경로 = super_admin', () => {
    expect(SRC).toMatch(/UPDATE users SET must_change_password = false WHERE id = \$1/);
    expect(SRC).toMatch(/channel: 'super_admin'/);
  });
});
