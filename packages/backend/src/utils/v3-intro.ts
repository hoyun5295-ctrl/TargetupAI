/**
 * v3-intro.ts — 로그인 직후 안내 창(「한줄로 V3」 장면 창 · 이미지 스튜디오 무료체험 창)의 판정 한 곳
 *   (★ 2026-11-13 C133 F7 · 설계서 docs/2026-11-13-hanjul-v3-design.md §2 → ★ 2026-11-16 C136 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2)
 *
 * 한 곳에서 정하는 것
 *   ① 대상 = 고객사 사용자(슈퍼관리자 · 회사 없는 토큰 제외) · 에이전트 전용 회사 제외(utils/gated-content canSeeIntroContent).
 *   ② 노출 = 한 계정에 최대 3번 · 한 로그인에 한 번(판을 통틀어) · 「다시 보지 않기」 = 영구. **서버가 한 문장으로 선점한다**.
 *   ③ 어느 판인가 = 무료체험 자격이 있고 아직 신청하지 않았고 더 띄울 여지가 있으면 무료체험 창 · 그 밖 = 장면 창.
 *   ④ 창의 글 · 그림은 로그인 뒤에만 준다(content/gated/v3-popup.ts · 그림 = 로그인 주소). ★ C136 — 옛 판(포스터 3장 + 기능 칩)은 띄우지 않는다.
 *
 * ★ 2026-11-16 C136 — 순서가 「준비 → 그림 받기 → 선점」으로 바뀌었다(Codex 설계 1R):
 *   준비(peekIntro) = 판정을 읽기만 해서 어느 판인지와 그 판의 글을 준다(노출을 쓰지 않는다).
 *   선점(claimIntro) = 화면이 준비한 판의 열쇠를 싣고 온다. 판정을 다시 해서 그 열쇠와 같을 때만 노출 한 번을 쓴다.
 *   그래서 그림을 못 받은 로그인 · 준비와 선점 사이에 판이 바뀐 로그인은 노출을 쓰지 않는다.
 *   열쇠 없이 온 선점(배포 전에 받아 둔 옛 화면) = 띄우지 않는다 · 노출 0(옛 화면은 지워진 공개 그림을 가리킨다).
 *
 * 표 = user_intro_acks(배포 원장 C133-DDL-1). 표가 없으면 문장이 42P01 을 던진다 → 라우트가 503 DB_MIGRATION_PENDING.
 */
import { createHash } from 'crypto';
import { query } from '../config/database';
import { loadPlanContext, studioTrialEligible } from './plan-guard';   // ★ 2026-11-15 C135 무료체험 자격(요금제 판정의 주인 파일)
import { readStudioTrial } from './studio-trial';   // ★ 2026-11-15 C135 무료체험 갈래
import { canSeeIntroContent } from './gated-content';   // ★ 2026-11-16 C136 소개 내용을 받을 수 있는 계정
import { V3_POPUP_CSS, V3_SCENES_HTML, V3_TRIAL_HTML, V3_MORPH_SETS, type V3MorphSet } from '../content/gated/v3-popup';

/**
 * 옛 판(포스터 3장 + 기능 칩 · C133)의 열쇠 — ★ C136 부터 띄우지 않는다.
 *   남겨 두는 이유 = 열쇠 없이 오는 「다시 보지 않기」(배포 전에 받아 둔 옛 화면)가 적히는 자리다. 그 요청이 새 판을 숨기면 안 된다(Codex 설계 1R).
 */
export const V3_INTRO_KEY = 'v3-intro';
/** ★ 2026-11-16 C136 — 장면 창의 판 열쇠(옛 판을 3번 다 본 계정 · 숨긴 계정에도 새 내용이 닿는다) */
export const V3_SCENES_INTRO_KEY = 'v3-scenes';
/** ★ 2026-11-15 C135 — 무료체험 안내 창의 판 열쇠(노출 수 · 다시 보지 않기가 장면 창과 따로) */
export const STUDIO_TRIAL_INTRO_KEY = 'studio-trial';
/** 「다시 보지 않기」가 받는 판 열쇠(닫힌 목록) */
export const INTRO_KEYS: ReadonlyArray<string> = [V3_INTRO_KEY, V3_SCENES_INTRO_KEY, STUDIO_TRIAL_INTRO_KEY];
/** 지금 띄우는 판(선점이 받는 열쇠 · 옛 판은 없다) */
export const LIVE_INTRO_KEYS: ReadonlyArray<string> = [V3_SCENES_INTRO_KEY, STUDIO_TRIAL_INTRO_KEY];
export const V3_INTRO_MAX_SHOWN = 3;

export interface IntroUser { userId?: string; companyId?: string; userType?: string; loginId?: string }
export type IntroVariant = 'scenes' | 'trial';
/** 창의 글(그림 자리는 gated:파일이름 · 화면이 로그인 주소로 받아 바꾼다) */
export interface IntroContent { css: string; html: string; sets: readonly V3MorphSet[] }
export interface IntroDecision { introKey: string; variant: IntroVariant }
export type IntroPeek = { introKey: null } | (IntroDecision & { content: IntroContent });
export type IntroClaim = { show: false } | ({ show: true } & IntroDecision);

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

/** 이 로그인이 이미 창을 띄웠는가($1 사용자 · $2 로그인 표식) — 선점 SQL 의 문(gate)과 같은 진실을 읽기만 한다 */
export const INTRO_LOGIN_SEEN_SQL = `
  SELECT 1 FROM user_intro_acks WHERE user_id = $1::uuid AND $2 = ANY(login_marks) LIMIT 1`;

/** (순수) 판의 글 — 어느 판이든 같은 CSS · 업종 셋을 쓴다 */
export function introContentOf(variant: IntroVariant): IntroContent {
  return { css: V3_POPUP_CSS, html: variant === 'trial' ? V3_TRIAL_HTML : V3_SCENES_HTML, sets: V3_MORPH_SETS };
}

/**
 * 이 로그인에 띄울 판을 정한다 — **읽기만 한다**(노출을 쓰지 않는다). 띄울 것이 없으면 null.
 *   대상이 아니다 · 표식을 못 만든다 · 에이전트 전용 회사 · 이 로그인이 이미 창을 띄웠다 · 그 판을 다 띄웠거나 숨겼다 = null.
 *   어느 판인지는 여기서 **먼저** 정한다: 무료체험 판을 띄울 계정이면 무료체험 판 · 그 밖은 장면 판(무료체험 판이 안 되면 장면 판으로 넘어간다).
 */
export async function decideIntro(user: IntroUser | null | undefined, token: string | null | undefined): Promise<IntroDecision | null> {
  if (!isIntroAudience(user)) return null;
  const mark = introLoginMark(token);
  if (!mark) return null;
  if (!(await canSeeIntroContent(user))) return null;
  if ((await query(INTRO_LOGIN_SEEN_SQL, [user.userId, mark])).rows.length > 0) return null;
  if (await wantsStudioTrialIntro(user)) return { introKey: STUDIO_TRIAL_INTRO_KEY, variant: 'trial' };
  const state = (await query(INTRO_STATE_SQL, [user.userId, V3_SCENES_INTRO_KEY])).rows[0];
  if (state && (state.dismissed || Number(state.shown) >= V3_INTRO_MAX_SHOWN)) return null;
  return { introKey: V3_SCENES_INTRO_KEY, variant: 'scenes' };
}

/** 준비 — 띄울 판과 그 판의 글(노출을 쓰지 않는다 · 화면은 이 글의 그림을 다 받은 뒤에 선점한다) */
export async function peekIntro(user: IntroUser | null | undefined, token: string | null | undefined): Promise<IntroPeek> {
  const d = await decideIntro(user, token);
  return d ? { ...d, content: introContentOf(d.variant) } : { introKey: null };
}

/**
 * 선점 — 띄운다고 답한 요청 = 노출 한 번을 쓴 것.
 *   expectedKey = 화면이 준비한 판의 열쇠. 지금 띄우는 판의 열쇠가 아니면(없음 · 옛 판 · 모르는 값) 선점하지 않는다.
 *   판정을 다시 해서 그 열쇠와 다르면 선점하지 않는다(준비와 선점 사이에 판이 바뀌어도 노출을 쓰지 않는다).
 *   선점이 0행(같은 로그인의 다른 요청이 먼저 · 그 사이 다 띄움 · 숨김)이면 다른 판으로 넘어가지 않고 띄우지 않는다.
 */
export async function claimIntro(user: IntroUser | null | undefined, token: string | null | undefined, expectedKey?: unknown): Promise<IntroClaim> {
  if (typeof expectedKey !== 'string' || !LIVE_INTRO_KEYS.includes(expectedKey)) return { show: false };
  const d = await decideIntro(user, token);
  if (!d || d.introKey !== expectedKey) return { show: false };
  const claimed = await query(INTRO_CLAIM_SQL, [user!.userId, d.introKey, introLoginMark(token), V3_INTRO_MAX_SHOWN]);
  return claimed.rows.length > 0 ? { show: true, ...d } : { show: false };
}

/**
 * 무료체험 창을 띄울 계정인가 — 체험 자격(utils/plan-guard studioTrialEligible)이 있고 · 아직 신청 행이 없고 ·
 *   그 창을 더 띄울 여지가 있다(숨기지 않았고 상한 미만). 다 띄웠거나 숨긴 계정은 false = 장면 창 판정으로 간다.
 *   요금제 · 체험 표 · 노출 상태를 못 읽으면 false(모르면 체험 창을 띄우지 않는다 = 장면 창 판정으로).
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

/** 「다시 보지 않기」 — 대상이 아니면 아무것도 하지 않는다 · 판 열쇠는 닫힌 목록 안의 값만(밖의 값 · 없음 = 옛 판 = 새 판을 숨기지 않는다) */
export async function dismissIntro(user: IntroUser | null | undefined, introKey?: unknown): Promise<boolean> {
  if (!isIntroAudience(user)) return false;
  const key = typeof introKey === 'string' && INTRO_KEYS.includes(introKey) ? introKey : V3_INTRO_KEY;
  await query(INTRO_DISMISS_SQL, [user.userId, key]);
  return true;
}
