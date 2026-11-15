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
import { loadPlanContext, studioTrialEligible, type PlanContext } from './plan-guard';   // ★ 2026-11-15 C135 무료체험 자격(요금제 판정의 주인 파일)
import { v3LiveWith, type V3Feature } from './v3-stage';
import { readStudioTrial } from './studio-trial';   // ★ 2026-11-15 C135 무료체험 갈래

/** 소개 판 열쇠 — 다음 판 소개를 띄우려면 이 값을 바꾼다(노출 수 · 다시 보지 않기가 판마다 따로) */
export const V3_INTRO_KEY = 'v3-intro';
/** ★ 2026-11-15 C135 — 무료체험 안내 창의 판 열쇠(노출 수 · 다시 보지 않기가 V3 소개 창과 따로) */
export const STUDIO_TRIAL_INTRO_KEY = 'studio-trial';
/** 「다시 보지 않기」가 받는 판 열쇠(닫힌 목록 · 밖의 값 = V3 소개 창) */
export const INTRO_KEYS: ReadonlyArray<string> = [V3_INTRO_KEY, STUDIO_TRIAL_INTRO_KEY];
export const V3_INTRO_MAX_SHOWN = 3;
export const V3_INTRO_POSTER_COUNT = 3;
export const V3_INTRO_MAX_CHIPS = 4;

export interface IntroUser { userId?: string; companyId?: string; userType?: string; loginId?: string }
export interface IntroPoster { id: string; url: string }
export interface IntroChip { key: string; label: string; text: string }
export type IntroClaim =
  | { show: false }
  | { show: true; posters: IntroPoster[]; chips: IntroChip[] }
  | { show: true; variant: 'trial'; introKey: string; posters: IntroPoster[]; chips: IntroChip[] };

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
 * ★ 2026-11-15 C135 로그인 표식 문 — 한 로그인에 자동 안내 창은 **판을 통틀어 하나**.
 *   판 열쇠가 아니다(소개 판마다 따로 세는 노출 수와 별개 · 「다시 보지 않기」가 받는 닫힌 목록에도 없다).
 *   이 열쇠의 행은 그 계정의 최근 로그인 표식 몇 개만 든다(토큰은 로그인마다 바뀌고 몇 시간 안에 끝난다 → 오래된 표식은 다시 올 일이 없다).
 *   왜: 판이 둘(V3 소개 · 무료체험 안내)이 되면 판마다 따로 본 「이 로그인은 이미 띄웠다」가 서로를 모른다 →
 *       같은 로그인의 두 번째 요청이 다른 판을 한 번 더 띄우고 그 판의 노출 수까지 쓴다(Codex 구현 1R).
 */
export const INTRO_LOGIN_GATE_KEY = '_login';
export const INTRO_LOGIN_GATE_KEEP = 10;

/**
 * 노출 선점 한 문장($1 사용자 · $2 판 열쇠 · $3 로그인 표식 · $4 상한).
 *   행이 돌아온 요청만 띄운다. 두 조건을 한 문장에서 함께 잡는다:
 *   ① gate = 이 로그인 표식이 이 계정에서 처음인가(판을 통틀어 · 같은 로그인의 두 번째 요청은 어느 판이든 0행 · 동시에 와도 하나만).
 *      「처음」의 진실 = 그 계정의 **모든 행**의 login_marks 다(NOT EXISTS): 문 행이 생기기 전에(이 카드 배포 전) 어느 판이 이미 모은 표식도,
 *      문에서 밀려난 옛 표식도 여기서 걸린다(Codex 구현 2R). 문 행은 동시 요청을 한 줄로 세우는 자리다(같은 행을 고치려는 둘째는
 *      첫째가 끝난 뒤의 행을 다시 본다 → 그 표식이 이미 들어 있어 0행).
 *   ② 그 판의 노출 = 해제 안 함 ∧ 모은 표식 < 상한 ∧ 이 표식을 아직 안 모음. 첫 노출은 INSERT 갈래(행이 없으면 표식 하나로 만든다).
 *   ①은 지났는데 ②가 안 되면(그 판을 다 띄웠거나 숨김) 0행이고 이 로그인의 문은 쓰인 채다 = 이 로그인에는 띄우지 않는다.
 *   그래서 부르는 쪽은 **어느 판을 띄울지 먼저 정하고 한 번만** 부른다(선점이 실패했다고 다른 판으로 다시 부르지 않는다).
 */
export const INTRO_CLAIM_SQL = `
  WITH gate AS (
    INSERT INTO user_intro_acks AS g (user_id, intro_key, login_marks)
    SELECT $1::uuid, '${INTRO_LOGIN_GATE_KEY}', ARRAY[$3]::text[]
     WHERE NOT EXISTS (SELECT 1 FROM user_intro_acks x WHERE x.user_id = $1::uuid AND $3 = ANY(x.login_marks))
    ON CONFLICT (user_id, intro_key) DO UPDATE
       SET login_marks = (array_append(g.login_marks, $3))[greatest(1, cardinality(g.login_marks) - ${INTRO_LOGIN_GATE_KEEP - 2}):cardinality(g.login_marks) + 1],
           updated_at = now()
     WHERE NOT ($3 = ANY(g.login_marks))
    RETURNING 1
  )
  INSERT INTO user_intro_acks AS a (user_id, intro_key, login_marks)
  SELECT $1::uuid, $2::varchar, ARRAY[$3]::text[] FROM gate
  ON CONFLICT (user_id, intro_key) DO UPDATE
     SET login_marks = array_append(a.login_marks, $3), updated_at = now()
   WHERE a.dismissed_at IS NULL
     AND cardinality(a.login_marks) < $4::int
     AND NOT ($3 = ANY(a.login_marks))
  RETURNING cardinality(login_marks) AS shown`;

/** 판의 노출 상태 읽기($1 사용자 · $2 판 열쇠) — 그 판을 더 띄울 여지가 있는지를 선점 **전에** 본다(선점은 한 번만 하므로) */
export const INTRO_STATE_SQL = `
  SELECT dismissed_at IS NOT NULL AS dismissed, cardinality(login_marks) AS shown
    FROM user_intro_acks
   WHERE user_id = $1::uuid AND intro_key = $2`;

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
  // ★ 2026-11-15 C135 무료체험 갈래 — 자격이 있고 아직 신청하지 않았고 그 창을 더 띄울 여지가 있는 계정 = 무료체험 창
  //   (판 열쇠 따로 · 그림은 화면의 정적 파일이라 포스터 조건 없음). 어느 판을 띄울지는 여기서 **먼저** 정하고 선점은 한 번만 한다:
  //   선점이 0행(이 로그인이 이미 창을 띄웠다 · 그 사이 상태가 바뀌었다)이면 다른 판으로 넘어가지 않고 띄우지 않는다.
  if (await wantsStudioTrialIntro(user)) {
    const t = await query(INTRO_CLAIM_SQL, [user.userId, STUDIO_TRIAL_INTRO_KEY, mark, V3_INTRO_MAX_SHOWN]);
    return t.rows.length > 0 ? { show: true, variant: 'trial', introKey: STUDIO_TRIAL_INTRO_KEY, posters: [], chips: [] } : { show: false };
  }
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

/**
 * 무료체험 창을 띄울 계정인가 — 체험 자격(utils/plan-guard studioTrialEligible)이 있고 · 아직 신청 행이 없고 ·
 *   그 창을 더 띄울 여지가 있다(숨기지 않았고 상한 미만). 다 띄웠거나 숨긴 계정은 false = 종전 소개 창 판정으로 간다.
 *   요금제 · 체험 표 · 노출 상태를 못 읽으면 false(모르면 체험 창을 띄우지 않는다 = 종전 소개 창 판정으로).
 */
async function wantsStudioTrialIntro(user: Required<Pick<IntroUser, 'userId' | 'companyId'>> & IntroUser): Promise<boolean> {
  try {
    const plan = await loadPlanContext(user.companyId);
    if (!studioTrialEligible(plan, user)) return false;
    if ((await readStudioTrial(user.companyId)) !== null) return false;
    const state = (await query(INTRO_STATE_SQL, [user.userId, STUDIO_TRIAL_INTRO_KEY])).rows[0];
    return !state || (!state.dismissed && Number(state.shown) < V3_INTRO_MAX_SHOWN);
  } catch {
    return false;
  }
}

/** 「다시 보지 않기」 — 대상이 아니면 아무것도 하지 않는다 · 판 열쇠는 닫힌 목록 안의 값만(밖의 값 · 없음 = V3 소개 창) */
export async function dismissIntro(user: IntroUser | null | undefined, introKey?: unknown): Promise<boolean> {
  if (!isIntroAudience(user)) return false;
  const key = typeof introKey === 'string' && INTRO_KEYS.includes(introKey) ? introKey : V3_INTRO_KEY;
  await query(INTRO_DISMISS_SQL, [user.userId, key]);
  return true;
}
