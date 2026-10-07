/**
 * ★ CT: 기능 안내 원장 · 영상 내려주기 (★2026-10-07 Harold 「구멍 자체를 만들지 마」)
 *
 * 경위: 기능 안내 원장(쓰는 순서 · 직접 정할 것 · 지켜 주는 것)과 예시 영상 12편이 화면 코드 · 공개 폴더에 있어
 *   로그인 없이 누구나 받아 갈 수 있었다(hanjul.ai/videos/plan-feature/*.mp4 실측 · Harold 1007).
 *   → 원장 = content/plan-feature-intros.ts · 영상 = assets/plan-feature(공개 폴더 밖). 로그인한 사람에게만 내려준다.
 *
 * 영상 주소 = 잠깐만 유효한 서명 주소(/api/plans/feature-media?f=<파일>&u=&e=&s= · 경로 끝에 .mp4 를 두지 않는다: nginx 정적 파일 규칙이 가로채지 않게). <video> 는 토큰 머리글을 못 실으니 주소에 서명을 싣는다.
 *   서명 = HMAC(파일 · 사용자 · 만료) — 주소가 밖으로 돌아도 MEDIA_TTL 뒤엔 열리지 않고, 누구 주소였는지 남는다.
 * 워터마크 = 기능 설명 화면에만 · 미가입 · 무료 체험 회사에만(정상 유료 고객사 = 없음 · Harold 1007).
 *   WATERMARK_LOGIN_IDS(기본 'psy5868')는 요금제와 상관없이 언제나 건다.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PLAN_FEATURE_INTROS, PLAN_FEATURE_MIN_PLAN, type PlanFeatureIntro } from '../content/plan-feature-intros';
import { ABOUT_GROUPS, ABOUT_GUARDS, ABOUT_HERO, ABOUT_SLOT_IDS } from '../content/about-page';
import { isActivePaidPlan, loadPlanContext } from './plan-guard';
import { isAboutPageViewer } from './about-page-access';

export const MEDIA_DIR = path.join(__dirname, '../../assets/plan-feature');
/** 서명 주소 유효 시간 — 창을 열어 둔 채 오래 있어도 재생되게 넉넉히(화면은 이보다 일찍 다시 받는다) */
export const MEDIA_TTL_SEC = 12 * 3600;
const MEDIA_NAME_RE = /^[a-z][a-z-]{1,39}\.(mp4|jpg)$/;
const LOGICAL_PREFIX = '/videos/plan-feature/';

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET 없음: 영상 주소를 서명할 수 없다');
  return s;
}

function sign(file: string, uid: string, exp: number): string {
  return crypto.createHmac('sha256', secret()).update(`plan-feature-media|${file}|${uid}|${exp}`).digest('base64url');
}

/** 논리 경로(/videos/plan-feature/x.mp4) → 서명 주소 */
export function signedMediaUrl(logical: string, uid: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const file = logical.startsWith(LOGICAL_PREFIX) ? logical.slice(LOGICAL_PREFIX.length) : '';
  if (!MEDIA_NAME_RE.test(file)) return '';
  const exp = nowSec + MEDIA_TTL_SEC;
  return `/api/plans/feature-media?f=${file}&u=${encodeURIComponent(uid)}&e=${exp}&s=${sign(file, uid, exp)}`;
}

/** 서명 확인 — 맞으면 보낼 파일 절대 경로, 아니면 null */
export function resolveSignedMedia(file: string, q: any, nowSec = Math.floor(Date.now() / 1000)): string | null {
  if (!MEDIA_NAME_RE.test(String(file || ''))) return null;
  const uid = typeof q?.u === 'string' ? q.u : '';
  const exp = Number(q?.e);
  const sig = typeof q?.s === 'string' ? q.s : '';
  if (!uid || !Number.isFinite(exp) || exp < nowSec || exp > nowSec + MEDIA_TTL_SEC + 60 || !sig) return null;
  const want = Buffer.from(sign(file, uid, exp));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  const abs = path.join(MEDIA_DIR, file);
  return fs.existsSync(abs) ? abs : null;
}

export interface FeatureIntroUser { userId?: string; userType?: string; loginId?: string; companyId?: string | null }

/** 기능 설명 화면 워터마크 — 슈퍼관리자 X · 지정 계정 O · 그 밖은 미가입 · 무료 체험 회사만 */
export async function shouldWatermarkFeatureIntro(u: FeatureIntroUser): Promise<boolean> {
  if (!u || u.userType === 'super_admin') return false;
  const always = String(process.env.WATERMARK_LOGIN_IDS ?? 'psy5868').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (u.loginId && always.includes(String(u.loginId).trim().toLowerCase())) return true;
  if (!u.companyId) return true;
  const ctx = await loadPlanContext(u.companyId).catch(() => null);
  if (!ctx) return true; // 판정 실패는 거는 쪽(화면만 옅게 덮일 뿐 기능 영향 없음)
  const trial = ctx.planCode === 'TRIAL' || ctx.subscriptionStatus === 'trial';
  return trial || !isActivePaidPlan(ctx);
}

export interface FeatureIntrosPayload {
  minPlan: string;
  intros: PlanFeatureIntro[];
  watermark: boolean;
  /** /about 구성 — 허용 계정(ABOUT_PAGE_VIEWER_IDS)에만 */
  about: { groups: typeof ABOUT_GROUPS; hero: typeof ABOUT_HERO; slotIds: typeof ABOUT_SLOT_IDS; guards: typeof ABOUT_GUARDS } | null;
}

export async function buildFeatureIntrosPayload(u: FeatureIntroUser): Promise<FeatureIntrosPayload> {
  const uid = String(u.userId || '');
  const intros = PLAN_FEATURE_INTROS.map((f) => (f.video
    ? { ...f, video: { src: signedMediaUrl(f.video.src, uid), poster: signedMediaUrl(f.video.poster, uid) } }
    : f));
  return {
    minPlan: PLAN_FEATURE_MIN_PLAN,
    intros,
    watermark: await shouldWatermarkFeatureIntro(u),
    about: isAboutPageViewer(u) ? { groups: ABOUT_GROUPS, hero: ABOUT_HERO, slotIds: ABOUT_SLOT_IDS, guards: ABOUT_GUARDS } : null,
  };
}
