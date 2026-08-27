/**
 * 직원 등급 라벨 파리티 계약 (★2026-08-27 전송자격인증 3.2·3.3)
 *
 * 왜 있나
 *   등급 라벨의 원본은 백엔드 `utils/admin-role.ts` `ADMIN_ROLE_LABEL`이다.
 *   그런데 감사 로그 상세는 프론트 상수 파일의 순수 함수(`formatAuditDetail`)가 그리므로 서버 응답을 받을 수 없고,
 *   같은 라벨을 프론트에도 둘 수밖에 없다. **사본은 갈라진다** — 한쪽만 고치면 화면 두 곳이 다른 이름을 쓴다.
 *   심사 제출물에서 「지원팀장」과 「lead」가 섞이면 그것 자체가 지적거리다.
 *
 * 못 박는 것
 *   1. 등급 집합이 양쪽에서 같다(하나가 늘거나 줄면 깨진다).
 *   2. 등급마다 라벨 문자열이 정확히 같다.
 *
 * ⚠ 이 테스트는 프론트 소스를 **텍스트로 읽어** 비교한다(패키지 경계를 넘는 import를 만들지 않는다).
 *   같은 방식의 선례 = `audit-action-labels.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ADMIN_ROLE_LABEL, ADMIN_ROLES } from '../admin-role';

const FRONT = path.resolve(__dirname, '../../../../frontend/src/constants/audit-action-labels.ts');

/** 프론트 파일에서 ADMIN_ROLE_LABEL 블록만 뽑아 { key: 라벨 }로 만든다 */
function parseFrontRoleLabels(): Record<string, string> {
  const src = fs.readFileSync(FRONT, 'utf8');
  const m = src.match(/export const ADMIN_ROLE_LABEL: Record<string, string> = \{([\s\S]*?)\};/);
  if (!m) throw new Error('프론트 ADMIN_ROLE_LABEL 블록을 찾지 못했다 — 이름이 바뀌었으면 이 계약도 함께 고친다');
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']*)'\s*,/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

describe('등급 라벨은 백엔드와 프론트가 한 글자도 다르지 않다', () => {
  const front = parseFrontRoleLabels();

  it('추출 자체가 비면 이 계약이 죽은 것이다', () => {
    expect(Object.keys(front).length).toBeGreaterThan(0);
  });

  it('등급 집합이 같다', () => {
    expect(Object.keys(front).sort()).toEqual([...ADMIN_ROLES].sort());
  });

  it.each(ADMIN_ROLES)('%s 라벨이 같다', (role) => {
    expect(front[role]).toBe(ADMIN_ROLE_LABEL[role]);
  });
});
