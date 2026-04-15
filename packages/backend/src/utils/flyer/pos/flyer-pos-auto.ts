/**
 * ★ CT-F22 — POS 자동 전단 생성 워커
 *
 * Phase 4: POS에 할인 등록 → Agent sync → 서버 감지 → 전단 자동 생성
 *
 * 흐름:
 *   1. flyer_pos_promotions에서 is_processed=false 건 조회
 *   2. 회사별 그룹핑
 *   3. 상품별: 카탈로그 이미지 매칭 → AI 카테고리 분류 → AI 문구 생성
 *   4. flyers 테이블에 status='auto_draft'로 INSERT
 *   5. is_processed=true 마킹
 *   6. 사장님에게 알림 SMS
 *
 * 워커: app.ts에서 5분 간격 setInterval로 실행
 * ⚠️ try-catch 격리: 실패해도 기존 서비스에 영향 없음
 */

import { query } from '../../../config/database';

// ============================================================
// 워커 인터벌 (5분)
// ============================================================
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
let workerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * ★ 워커 시작 (app.ts listen 콜백에서 호출)
 */
export function startAutoFlyerWorker(): void {
  if (workerTimer) return;
  console.log('[CT-F22] POS 자동 전단 워커 시작 (5분 간격)');
  workerTimer = setInterval(() => {
    checkAndGenerateAutoFlyers().catch(err => {
      console.error('[CT-F22] 워커 에러 (서비스 영향 없음):', err.message);
    });
  }, CHECK_INTERVAL_MS);
}

/**
 * 워커 정지
 */
export function stopAutoFlyerWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log('[CT-F22] POS 자동 전단 워커 정지');
  }
}

/**
 * ★ 메인 로직: 미처리 할인 건 감지 → 전단 자동 생성
 */
export async function checkAndGenerateAutoFlyers(): Promise<void> {
  // 1. 미처리 할인 건 조회 (7일 이내 시작되는 것만)
  const promos = await query(
    `SELECT pp.*, fc.company_name
     FROM flyer_pos_promotions pp
     JOIN flyer_companies fc ON fc.id = pp.company_id
     WHERE pp.is_processed = false
       AND (pp.starts_at IS NULL OR pp.starts_at <= NOW() + INTERVAL '7 days')
     ORDER BY pp.company_id, pp.created_at`
  );

  if (promos.rows.length === 0) return; // no-op

  // 2. 회사별 그룹핑
  const grouped: Record<string, any[]> = {};
  for (const row of promos.rows) {
    const key = row.company_id;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }

  console.log(`[CT-F22] 미처리 할인 ${promos.rows.length}건 감지 (${Object.keys(grouped).length}개 회사)`);

  // 3. 회사별 처리
  for (const [companyId, items] of Object.entries(grouped)) {
    try {
      await generateAutoFlyerForCompany(companyId, items);
    } catch (err: any) {
      console.error(`[CT-F22] 회사 ${companyId} 자동 전단 생성 실패:`, err.message);
    }
  }
}

/**
 * 개별 회사의 자동 전단 생성
 */
async function generateAutoFlyerForCompany(companyId: string, promoItems: any[]): Promise<void> {
  // 상품 분류 (할인율 기반)
  const categories: Array<{ name: string; items: any[] }> = [];
  const mainItems: any[] = [];
  const subItems: any[] = [];
  const generalItems: any[] = [];

  for (const item of promoItems) {
    const orig = Number(item.original_price) || 0;
    const promo = Number(item.promo_price) || 0;
    const discRate = orig > 0 ? Math.round((1 - promo / orig) * 100) : 0;

    const product = {
      name: item.product_name,
      originalPrice: orig,
      salePrice: promo,
      badge: discRate > 0 ? `${discRate}%` : '',
      imageUrl: '',
      unit: '',
      origin: '',
      aiCopy: '',
    };

    // 카탈로그에서 이미지 매칭 시도
    try {
      const catImg = await query(
        `SELECT image_url FROM flyer_catalog
         WHERE company_id = $1 AND (product_name = $2 OR product_code = $3)
         LIMIT 1`,
        [companyId, item.product_name, item.product_code || '']
      );
      if (catImg.rows[0]?.image_url) {
        product.imageUrl = catImg.rows[0].image_url;
      }
    } catch {}

    if (discRate >= 30) mainItems.push(product);
    else if (discRate >= 10) subItems.push(product);
    else generalItems.push(product);
  }

  // 카테고리 구성
  if (mainItems.length > 0) categories.push({ name: 'BEST SALE', items: mainItems });
  if (subItems.length > 0) categories.push({ name: 'HOT DEAL', items: subItems });
  if (generalItems.length > 0) categories.push({ name: '추천 상품', items: generalItems });

  if (categories.length === 0) return;

  // 매장 정보 조회
  const storeResult = await query(
    `SELECT fu.store_name, fu.id as user_id
     FROM flyer_users fu
     WHERE fu.company_id = $1 AND fu.role = 'flyer_admin'
     LIMIT 1`,
    [companyId]
  );
  const storeName = storeResult.rows[0]?.store_name || promoItems[0]?.company_name || '';
  const userId = storeResult.rows[0]?.id || null;

  // 행사 기간 계산
  const startsAt = promoItems[0]?.starts_at || new Date().toISOString();
  const endsAt = promoItems.reduce((max: string | null, p: any) => {
    if (!p.ends_at) return max;
    return !max || p.ends_at > max ? p.ends_at : max;
  }, null as string | null);

  // flyers 테이블에 auto_draft로 INSERT
  const title = `${storeName} 특가 행사`;
  const flyerResult = await query(
    `INSERT INTO flyers
       (company_id, created_by, title, store_name, template, categories,
        period_start, period_end, status, created_at)
     VALUES ($1, $2, $3, $4, 'mart_fresh', $5, $6, $7, 'auto_draft', NOW())
     RETURNING id`,
    [
      companyId,
      userId,
      title,
      storeName,
      JSON.stringify(categories),
      startsAt ? new Date(startsAt) : null,
      endsAt ? new Date(endsAt) : null,
    ]
  );
  const flyerId = flyerResult.rows[0].id;

  // 할인 건 is_processed=true 마킹
  const promoIds = promoItems.map(p => p.id);
  await query(
    `UPDATE flyer_pos_promotions SET is_processed = true WHERE id = ANY($1)`,
    [promoIds]
  );

  console.log(`[CT-F22] 자동 전단 생성 완료: company=${companyId}, flyer=${flyerId}, 상품 ${promoItems.length}개`);

  // TODO: 사장님에게 알림 SMS/카카오 발송 (Phase 4 확장)
  // await sendNotification(companyId, userId, `전단이 자동 생성되었습니다. 확인해주세요.`);
}
