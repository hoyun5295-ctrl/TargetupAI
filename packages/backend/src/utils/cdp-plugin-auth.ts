/**
 * 플러그인 키 인증 미들웨어(★ 2026-10-28 자사몰 대비 K8 · D9 · I10)
 *
 * 헤더 `X-Hanjullo-Plugin-Key` = 몰 하나의 키(CT cdp-plugin-key). 통과하면 req.pluginIntegration 에 그 몰 행.
 * 회사 상태 · 요금제 = 전권 키(requireCdpApiKey)의 사실 경로와 같은 문(★1028 K7 요금제가 끝난 뒤 90일까지) · 출발지 = 범위 company_plugin(기본 기록만 · 고객사가 등록하면 그 회사만 차단).
 * 월 호출 한도는 걸지 않는다(회원 토큰 = 사실 경로 · K7 분류).
 */
import type { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { guardMachineOrigin } from './geo-access';
import { cdpFactCollectGate } from './cdp-auth';
import { findWooIntegrationByPluginKey, type WooIntegration } from './woocommerce-client';

// Request 확장(cdp-auth 의 cdpAuth 와 같은 꼴)
declare module 'express-serve-static-core' {
  interface Request {
    pluginIntegration?: WooIntegration;
  }
}

export async function requireCdpPluginKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const integ = await findWooIntegrationByPluginKey(req.headers['x-hanjullo-plugin-key']);
    if (!integ) {
      res.status(401).json({ success: false, error: '플러그인 키가 맞지 않아요. 한줄로 연동 화면에서 이 몰의 플러그인 키를 다시 넣어 주세요.', code: 'INVALID_PLUGIN_KEY' });
      return;
    }
    const co = await query(`SELECT status FROM companies WHERE id = $1::uuid`, [integ.companyId]);
    if (co.rows[0]?.status !== 'active' || !(await cdpFactCollectGate(integ.companyId)).allowed) {
      res.status(403).json({ success: false, error: '한줄로 CDP는 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
      return;
    }
    if (!(await guardMachineOrigin(req, res, integ.companyId, 'company_plugin'))) return;
    req.pluginIntegration = integ;
    next();
  } catch (err: any) {
    console.error('[CDP plugin auth] 인증 처리 실패:', err?.message || err);
    res.status(500).json({ success: false, error: '플러그인 인증 처리 중 오류가 발생했습니다.' });
  }
}
