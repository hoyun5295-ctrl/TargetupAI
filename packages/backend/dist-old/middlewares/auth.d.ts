import { Request, Response, NextFunction } from 'express';
export interface JwtPayload {
    userId: string;
    companyId?: string;
    userType: 'super_admin' | 'company_admin' | 'company_user';
    loginId: string;
    sessionId?: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}
export declare const generateToken: (payload: JwtPayload) => string;
export declare const authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
export declare const requireSuperAdmin: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const requireCompanyAdmin: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
declare const _default: {
    authenticate: (req: Request, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
    requireSuperAdmin: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
    requireCompanyAdmin: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
    generateToken: (payload: JwtPayload) => string;
};
export default _default;
//# sourceMappingURL=auth.d.ts.map