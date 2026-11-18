/**
 * jbn-public.ts: 공개 JBN 전용 페이지(/jbn)의 서버 읽기, 신청 보내기(★ 2026-11-18 C144, 설계서 docs/2026-11-18-c144-jbn-special-price-design.md §4-1)
 *   가격은 서버의 JBN 판 요금제 행에서만 읽는다(화면에 숫자를 적어 두지 않는다, 할인율도 두 값으로 계산).
 *   신청 하나 = id 하나(처음 보낼 때 만든다), 서버가 같은 id 를 한 행으로 받으니 응답을 못 받고 다시 보내도 한 번이다.
 */
export interface JbnPlan {
  /** 원 요금제 코드(인프라 문구, 관심 요금제 값) */
  code: string;
  name: string;
  basePrice: number;
  price: number;
  credits: number;
}

export const JBN_PLANS_URL = '/api/public/jbn/plans';
export const JBN_APPLY_URL = '/api/public/jbn/apply';

export const JBN_CONSULT_CHOICES = [
  { key: 'phone', label: '전화 상담' },
  { key: 'visit', label: '방문 상담' },
  { key: 'video', label: '화상 상담' },
] as const;
export type JbnConsultKey = (typeof JBN_CONSULT_CHOICES)[number]['key'];

/** 신청 id(uuid v4, 서버가 꼴을 본다) */
export function newApplicationId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 할인율(정가와 JBN 가격으로, 정수 %) */
export function discountPct(basePrice: number, price: number): number {
  if (!(basePrice > 0) || !(price >= 0)) return 0;
  return Math.round((1 - price / basePrice) * 100);
}

export const won = (n: number): string => `${Math.round(n).toLocaleString('ko-KR')}원`;

/** 요금 읽기: 실패는 던진다(화면이 「불러오지 못했습니다, 다시 시도」를 그린다) */
export async function fetchJbnPlans(signal?: AbortSignal): Promise<JbnPlan[]> {
  const r = await fetch(JBN_PLANS_URL, { signal, cache: 'no-store' });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.success !== true || !Array.isArray(d.plans)) throw new Error('JBN_PLANS_FAILED');
  return d.plans.map((p: any) => ({
    code: String(p.code), name: String(p.name),
    basePrice: Number(p.basePrice) || 0, price: Number(p.price) || 0, credits: Number(p.credits) || 0,
  }));
}

export interface JbnApplyBody {
  id: string;
  companyName: string;
  ownerName: string;
  nickname: string;
  phone: string;
  interestPlanCode: string | null;
  consultMethod: JbnConsultKey;
  memo: string;
  consent: boolean;
  /** 사람 눈에 안 보이는 칸(자동 입력 거름) */
  website: string;
}

/**
 * 신청 보내기: definitive = 서버가 「받지 않았다」고 분명히 답했다(400, 틀린 칸).
 * 그 밖의 실패(끊김, 500, 503)는 저장됐는지 모르므로 같은 id 로 다시 보낸다.
 */
export async function submitJbnApplication(body: JbnApplyBody, signal?: AbortSignal):
  Promise<{ ok: true } | { ok: false; definitive: boolean; error: string }> {
  try {
    const r = await fetch(JBN_APPLY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.success === true) return { ok: true };
    return { ok: false, definitive: r.status === 400, error: d?.error || '신청을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.' };
  } catch {
    return { ok: false, definitive: false, error: '연결이 끊겼습니다. 다시 눌러 주시면 이어서 보냅니다.' };
  }
}
