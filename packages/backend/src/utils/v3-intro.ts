/**
 * v3-intro.ts — 로그인 직후 「한줄로 V3」 소개 창의 판정 한 곳 (★ 2026-11-13 C133 F7 · 설계서 docs/2026-11-13-hanjul-v3-design.md §2)
 *
 * 한 곳에서 정하는 것
 *   ① 대상 = 고객사 사용자(슈퍼관리자 · 회사 없는 토큰 제외) · 가입 여부를 가리지 않는다.
 *   ② 노출 = 한 계정에 최대 3번 · 한 로그인에 한 번 · 「다시 보지 않기」 = 영구. **서버가 한 문장으로 선점한다**
 *      (성공한 로그인 표식을 3개까지 모아 둔다 → 두 기기가 동시에 와도 · 같은 로그인의 늦은 요청이 끼어도 넘지 않는다).
 *   ③ 포스터 = 이미지 스튜디오 실샘플 3장(회사 업종 카테고리 먼저). 3장이 안 되면 띄우지 않는다(모르면 띄우지 않는다).
 *   ④ 칩 = 「그 회사가 지금 쓸 수 있는 V3 기능」만 — 기능의 입구가 쓰는 단계 개방 판정(v3-stage)을 그대로 부른다.
 *      아직 열지 않은 기능을 약속하지 않는다(로드맵 노출 금지).
 *
 * ⛔ 문구에 약속 숫자 · 「업계 최고」 · 「무료」 · 영문 제품명 · AI 모델 이름을 쓰지 않는다(계약 시험).
 * 표 = user_intro_acks(배포 원장 C133-DDL-1). 표가 없으면 쓰기 문장이 42P01 을 던진다 → 라우트가 503 DB_MIGRATION_PENDING.
 */
import { createHash } from 'crypto';
import { query } from '../config/database';
import { listTemplatesPublic } from './image-studio-templates';
import { findTemplateSample } from './image-studio';
import { studioIndustryCategories } from './sales-outreach-produce';
import { resolveCompanyIndustry } from './copy-prompt-composer';
import { loadPlanContext, type PlanContext } from './plan-guard';
import { v3LiveWith, type V3Feature } from './v3-stage';

/** 소개 판 열쇠 — 다음 판 소개를 띄우려면 이 값을 바꾼다(노출 수 · 다시 보지 않기가 판마다 따로) */
export const V3_INTRO_KEY = 'v3-intro';
export const V3_INTRO_MAX_SHOWN = 3;
export const V3_INTRO_POSTER_COUNT = 3;
export const V3_INTRO_MAX_CHIPS = 4;

export interface IntroUser { userId?: string; companyId?: string; userType?: string }
export interface IntroPoster { id: string; url: string }
export interface IntroChip { key: string; label: string; text: string }
export type IntroClaim = { show: false } | { show: true; posters: IntroPoster[]; chips: IntroChip[] };

/** 칩 후보(순서 = 화면 순서) — feature 가 있으면 그 기능이 열린 회사에만 보인다 */
export const V3_INTRO_CHIPS: ReadonlyArray<IntroChip & { feature: V3Feature | null }> = [
  { key: 'image-studio', label: '이미지 스튜디오', text: '사진 한 장으로 포스터', feature: null },
  { key: 'journey-pack', label: '기본 여정 한 번에', text: '가입부터 재구매까지 한 번에 켜기', feature: 'journey-pack' },
  { key: 'product-insight', label: '상품 반응', text: '많이 본 상품 · 검색어에서 바로 보내기', feature: 'product-insight' },
  { key: 'benchmark', label: '업종 평균 비교', text: '같은 업종 평균과 견주기', feature: 'benchmark' },
  { key: 'split', label: '반응 좋은 문안으로', text: '문안 여러 개 중 반응 좋은 쪽으로', feature: 'split' },
  { key: 'inbox', label: '답장 상담', text: '고객 답장에 AI 가 먼저 답합니다', feature: 'inbox' },
];

/** (순수) 대상인가 */
export function isIntroAudience(user: IntroUser | null | undefined): user is Required<Pick<IntroUser, 'userId' | 'companyId'>> & IntroUser {
  return !!user && user.userType !== 'super_admin' && !!user.companyId && !!user.userId;
}

/** (순수) 이 로그인의 표식 — 토큰은 로그인할 때만 바뀐다(화면의 로그인 표식과 같은 전제) · 토큰 원문은 저장하지 않는다 */
export function introLoginMark(token: string | null | undefined): string | null {
  const t = String(token || '').trim();
  return t ? createHash('sha256').update(t).digest('hex').slice(0, 32) : null;
}

/**
 * (순수) 포스터 고르기 — 회사 업종 카테고리의 템플릿을 먼저, 모자라면 나머지에서(목록 순서 그대로).
 *   실샘플 파일이 있는 템플릿만. count 장을 못 채우면 빈 배열(= 창을 띄우지 않는다).
 */
export function pickIntroPosters(
  templates: ReadonlyArray<{ id: string; category: string }>,
  industryCategories: ReadonlyArray<string> | null,
  sampleOf: (templateId: string) => { v: number } | null,
  count: number = V3_INTRO_POSTER_COUNT,
): IntroPoster[] {
  const preferred = new Set(industryCategories || []);
  const ordered = [...templates.filter((t) => preferred.has(t.category)), ...templates.filter((t) => !preferred.has(t.category))];
  const out: IntroPoster[] = [];
  for (const t of ordered) {
    const s = sampleOf(t.id);
    if (!s) continue;
    out.push({ id: t.id, url: `/api/image-studio/template-sample/${t.id}?v=${s.v}` });
    if (out.length >= count) return out;
  }
  return [];
}

/** (순수) 이 회사에 보일 칩 — 열린 기능만 · 최대 4개 */
export function introChipsFor(companyId: string, ctx: PlanContext | null): IntroChip[] {
  return V3_INTRO_CHIPS
    .filter((c) => c.feature === null || v3LiveWith(c.feature, companyId, ctx))
    .slice(0, V3_INTRO_MAX_CHIPS)
    .map(({ key, label, text }) => ({ key, label, text }));
}

/**
 * 노출 선점 한 문장($1 사용자 · $2 판 열쇠 · $3 로그인 표식 · $4 상한).
 *   행이 돌아온 요청만 띄운다. 조건 = 해제 안 함 ∧ 모은 표식 < 상한 ∧ 이 표식을 아직 안 모음.
 *   첫 노출은 INSERT 갈래(행이 없으면 표식 하나로 만든다) — 이때도 행이 돌아온다.
 */
export const INTRO_CLAIM_SQL = `
  INSERT INTO user_intro_acks AS a (user_id, intro_key, login_marks)
  VALUES ($1::uuid, $2, ARRAY[$3]::text[])
  ON CONFLICT (user_id, intro_key) DO UPDATE
     SET login_marks = array_append(a.login_marks, $3), updated_at = now()
   WHERE a.dismissed_at IS NULL
     AND cardinality(a.login_marks) < $4::int
     AND NOT ($3 = ANY(a.login_marks))
  RETURNING cardinality(login_marks) AS shown`;

/** 「다시 보지 않기」($1 사용자 · $2 판 열쇠) — 행이 없어도 만든다 · 이미 해제면 처음 해제 시각 그대로 */
export const INTRO_DISMISS_SQL = `
  INSERT INTO user_intro_acks AS a (user_id, intro_key, dismissed_at)
  VALUES ($1::uuid, $2, now())
  ON CONFLICT (user_id, intro_key) DO UPDATE
     SET dismissed_at = COALESCE(a.dismissed_at, now()), updated_at = now()`;

/**
 * 소개 창을 띄울지 정한다(띄운다고 답한 요청 = 노출 한 번을 쓴 것).
 *   대상이 아니거나 · 표식을 못 만들거나 · 포스터 3장이 없으면 선점하지 않고 show: false.
 *   ⛔ 포스터 확인이 선점보다 먼저다 — 띄울 수 없는데 노출 수만 쓰지 않는다.
 */
export async function claimIntro(user: IntroUser | null | undefined, token: string | null | undefined): Promise<IntroClaim> {
  if (!isIntroAudience(user)) return { show: false };
  const mark = introLoginMark(token);
  if (!mark) return { show: false };
  const industry = await resolveCompanyIndustry(user.companyId);
  const posters = pickIntroPosters(listTemplatesPublic(), studioIndustryCategories(industry), findTemplateSample);
  if (posters.length < V3_INTRO_POSTER_COUNT) return { show: false };
  const claimed = await query(INTRO_CLAIM_SQL, [user.userId, V3_INTRO_KEY, mark, V3_INTRO_MAX_SHOWN]);
  if (claimed.rows.length === 0) return { show: false };
  let ctx: PlanContext | null = null;
  try {
    ctx = await loadPlanContext(user.companyId);
  } catch {
    ctx = null;   // 요금제를 못 읽으면 단계 기능 칩은 빠지고 이미지 스튜디오 칩만 남는다(모르면 약속하지 않는다)
  }
  return { show: true, posters, chips: introChipsFor(user.companyId, ctx) };
}

/** 「다시 보지 않기」 — 대상이 아니면 아무것도 하지 않는다 */
export async function dismissIntro(user: IntroUser | null | undefined): Promise<boolean> {
  if (!isIntroAudience(user)) return false;
  await query(INTRO_DISMISS_SQL, [user.userId, V3_INTRO_KEY]);
  return true;
}
