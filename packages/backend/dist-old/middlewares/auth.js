"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireCompanyAdmin = exports.requireSuperAdmin = exports.authenticate = exports.generateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../config/database");
const defaults_1 = require("../config/defaults");
// ★ 보안: JWT_SECRET 미설정 시 서버 기동 차단 (fail-fast)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ [FATAL] JWT_SECRET 환경변수가 설정되지 않았습니다. 서버를 시작할 수 없습니다.');
    process.exit(1);
}
const generateToken = (payload) => {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: defaults_1.LIMITS.jwtExpiry });
};
exports.generateToken = generateToken;
// last_activity_at 갱신 주기 (5분)
const ACTIVITY_UPDATE_INTERVAL = defaults_1.TIMEOUTS.activityUpdate;
const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded;
        // sessionId 없는 기존 토큰은 통과 (배포 후 자연 만료)
        if (!decoded.sessionId) {
            return next();
        }
        // ★ 세션 유효성 체크 — is_active + expires_at 만료 여부
        const sessionResult = await (0, database_1.query)('SELECT id, last_activity_at, expires_at FROM user_sessions WHERE id = $1 AND user_id = $2 AND is_active = true', [decoded.sessionId, decoded.userId]);
        if (sessionResult.rows.length === 0) {
            return res.status(401).json({
                error: '다른 곳에서 로그인되어 현재 세션이 종료되었습니다.',
                forceLogout: true
            });
        }
        // ★ 보안: expires_at 지났으면 세션 만료 처리 (브라우저 닫았다 열어도 서버가 차단)
        const expiresAt = new Date(sessionResult.rows[0].expires_at);
        const now = new Date();
        if (now > expiresAt) {
            // 세션 비활성화
            (0, database_1.query)('UPDATE user_sessions SET is_active = false WHERE id = $1', [decoded.sessionId]).catch(() => { });
            return res.status(401).json({
                error: '세션이 만료되었습니다. 다시 로그인해주세요.',
                forceLogout: true
            });
        }
        // last_activity_at + expires_at 갱신 (5분 간격 — DB 부하 최소화)
        const lastActivity = new Date(sessionResult.rows[0].last_activity_at);
        if (now.getTime() - lastActivity.getTime() > ACTIVITY_UPDATE_INTERVAL) {
            // 활동이 있으면 expires_at도 연장
            const timeoutMinutes = decoded.userType === 'super_admin'
                ? defaults_1.TIMEOUTS.superAdminSessionMinutes
                : 30; // 기본값, extend-session에서 정확한 값으로 갱신
            (0, database_1.query)(`UPDATE user_sessions SET last_activity_at = NOW(), expires_at = NOW() + INTERVAL '1 minute' * $2 WHERE id = $1`, [decoded.sessionId, timeoutMinutes]).catch(err => console.error('세션 활동 갱신 실패:', err));
        }
        next();
    }
    catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};
exports.authenticate = authenticate;
const requireSuperAdmin = (req, res, next) => {
    if (!req.user || req.user.userType !== 'super_admin') {
        return res.status(403).json({ error: 'Super admin access required' });
    }
    next();
};
exports.requireSuperAdmin = requireSuperAdmin;
const requireCompanyAdmin = (req, res, next) => {
    if (!req.user || (req.user.userType !== 'company_admin' && req.user.userType !== 'super_admin')) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};
exports.requireCompanyAdmin = requireCompanyAdmin;
exports.default = { authenticate: exports.authenticate, requireSuperAdmin: exports.requireSuperAdmin, requireCompanyAdmin: exports.requireCompanyAdmin, generateToken: exports.generateToken };
//# sourceMappingURL=auth.js.map