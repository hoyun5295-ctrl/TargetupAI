/**
 * gated-content.ts — 로그인 뒤에만 내려주는 소개 내용의 문 (★ 2026-11-16 C136 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2-1)
 *
 * Harold 「의미없이 전부 공개로 해놓으면 서비스 내용만 가져가서 복제」 → 소개 글 · 예시 그림은 프론트 번들 · public 폴더에 두지 않고
 *   여기(백엔드 보관)에서 로그인한 고객사 사용자에게만 준다.
 *   - 받을 수 있는 계정 = 고객사 사용자(슈퍼관리자 · 회사 없는 토큰 제외) · 에이전트 전용 회사 제외(동종 업체에 소개를 보이지 않는다 · App.tsx AGENT_ALLOWED_PATHS 와 같은 이유)
 *   - 그림 = packages/backend/assets/gated/v3 폴더에 실제로 있는 이름일 때만(닫힌 목록 = 그 폴더)
 *   - 응답 머리말 = private, no-store(브라우저 캐시에 남기지 않는다 · 라우트가 붙인다)
 * ⛔ 이 폴더의 그림 · content/gated 의 글을 공개 주소나 프론트 저장소로 내보내지 않는다(계약 시험 c136-gated-content).
 */
import fs from 'fs';
import path from 'path';
import { query } from '../config/database';

/** 그림 보관 폴더(src · dist · dist-old 어디서 돌아도 같은 자리 = 패키지 뿌리의 assets) */
export const GATED_IMAGE_DIR = path.resolve(__dirname, '..', '..', 'assets', 'gated', 'v3');
export const GATED_CACHE_CONTROL = 'private, no-store';

const IMAGE_MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.webp': 'image/webp' };

/** (순수) 그림 이름 꼴 — 영문 소문자 · 숫자 · 붙임표 + 확장자 둘(경로 조각 · 점 둘은 여기서 걸린다) */
export function isGatedImageName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z0-9-]{1,60}\.(jpg|webp)$/.test(name);
}

/** 그림 파일 — 꼴이 맞고 보관 폴더에 실제로 있는 이름일 때만 */
export function gatedImageFile(name: unknown, dir: string = GATED_IMAGE_DIR): { absPath: string; mime: string } | null {
  if (!isGatedImageName(name)) return null;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  if (!names.includes(name)) return null;
  return { absPath: path.join(dir, name), mime: IMAGE_MIME[path.extname(name)] };
}

export interface GatedUser { userId?: string; companyId?: string; userType?: string }

/** (순수) 고객사 사용자인가 — 슈퍼관리자 · 회사 없는 토큰은 소개 내용의 대상이 아니다 */
export function isCompanyUser(user: GatedUser | null | undefined): user is GatedUser & { userId: string; companyId: string } {
  return !!user && user.userType !== 'super_admin' && !!user.companyId && !!user.userId;
}

/** 에이전트 전용 회사를 가르는 값(routes/auth.ts 로그인 판정이 읽는 칸 · 비면 web) */
export const COMPANY_USAGE_SQL = `SELECT usage_type FROM companies WHERE id = $1::uuid`;

/**
 * 소개 내용을 받을 수 있는 계정인가 — 고객사 사용자 ∧ 회사가 있고 ∧ 에이전트 전용이 아니다.
 *   회사 조회가 실패하면 던진다(부르는 쪽이 「모르면 주지 않는다」로 접는다).
 */
export async function canSeeIntroContent(user: GatedUser | null | undefined): Promise<boolean> {
  if (!isCompanyUser(user)) return false;
  const r = await query(COMPANY_USAGE_SQL, [user.companyId]);
  return r.rows.length > 0 && String(r.rows[0].usage_type || 'web') !== 'agent';
}
