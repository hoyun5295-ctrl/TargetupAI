/**
 * ★ 전단AI 전용 인증 미들웨어 (CT-F)
 *
 * 한줄로 middlewares/auth.ts와 완전 분리.
 * - flyer_users 테이블 기반 사용자 인증
 * - JWT payload에 service='flyer' 강제 주입 → 한줄로 토큰 교차 사용 차단
 * - flyer_companies 기반 회사 격리
 *
 * 참조 문서: FLYER-MIGRATION-PLAN.md, FLYER-SUPERADMIN.md
 */
import { Request, Response, NextFunction } from 'express';
export interface FlyerJwtPayload {
    service: 'flyer';
    userId: string;
    companyId: string;
    role: 'flyer_admin' | 'flyer_staff';
    loginId: string;
    businessType: string;
    sessionId?: string;
}
declare global {
    namespace Express {
        interface Request {
            flyerUser?: FlyerJwtPayload;
        }
    }
}
export declare const generateFlyerToken: (payload: Omit<FlyerJwtPayload, "service">) => string;
export declare const verifyFlyerToken: (token: string) => FlyerJwtPayload;
/**
 * 전단AI 전용 인증 미들웨어.
 * 한줄로 authenticate와 엄격히 분리. 한줄로 토큰은 service 필드 없어서 거부됨.
 */
export declare const flyerAuthenticate: (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * flyer_admin 권한 전용 가드 (사장님). flyer_staff(직원) 차단.
 */
export declare const requireFlyerAdmin: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
declare const _default: {
    flyerAuthenticate: (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
    requireFlyerAdmin: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
    generateFlyerToken: (payload: Omit<FlyerJwtPayload, "service">) => string;
    verifyFlyerToken: (token: string) => FlyerJwtPayload;
};
export default _default;
//# sourceMappingURL=flyer-auth.d.ts.map