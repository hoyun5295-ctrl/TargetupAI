/**
 * Agent 자체 알림 모듈
 *
 * 서버 연결 불가, DB 장애, 동기화 연속 실패 시 관리자에게 이메일 알림
 *
 * 설치 필요: npm install nodemailer @types/nodemailer
 *
 * 트리거 조건:
 * - Heartbeat 연속 N회 실패 (기본 3회 = 15분)
 * - 동기화 연속 N회 실패 (기본 5회)
 * - DB 연결 실패 (즉시)
 *
 * 알림 정책:
 * - 동일 이벤트 쿨다운 (기본 1시간)
 * - 복구 시 복구 알림 발송
 *
 * .env 설정:
 *   ALERT_ENABLED=true
 *   ALERT_EMAIL_TO=admin@invito.kr
 *   ALERT_SMTP_HOST=smtp.gmail.com
 *   ALERT_SMTP_PORT=587
 *   ALERT_SMTP_USER=alert@invito.kr
 *   ALERT_SMTP_PASS=app-password
 */

import { getLogger } from '../logger';

const logger = getLogger('alert');

// ─── 타입 ───────────────────────────────────────────────

type AlertType =
  | 'server_unreachable'
  | 'db_connection_failed'
  | 'sync_failed'
  | 'server_recovered'
  | 'db_recovered';

interface AlertEvent {
  type: AlertType;
  message: string;
  details?: string;
  timestamp: Date;
}

export interface AlertConfig {
  enabled: boolean;
  emailTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecure?: boolean;
  heartbeatThreshold?: number;  // 기본 3
  syncThreshold?: number;       // 기본 5
  cooldownMinutes?: number;     // 기본 60
  agentName?: string;
  companyName?: string;
}

// ─── AlertManager ───────────────────────────────────────

export class AlertManager {
  private config: AlertConfig;
  private nodemailer: any = null;
  private transporter: any = null;

  // 연속 실패 카운터
  private heartbeatFailCount = 0;
  private syncFailCount = 0;

  // 쿨다운 (타입별 마지막 알림 시각)
  private lastAlertTime: Map<AlertType, number> = new Map();

  // 상태 추적 (복구 알림용)
  private serverWasDown = false;
  private dbWasDown = false;

  constructor(config: AlertConfig) {
    this.config = {
      smtpSecure: false,
      heartbeatThreshold: 3,
      syncThreshold: 5,
      cooldownMinutes: 60,
      agentName: 'Sync Agent',
      companyName: '',
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('알림 모듈 비활성화 (ALERT_ENABLED=false)');
      return;
    }

    if (!this.config.emailTo || !this.config.smtpUser) {
      logger.warn('알림 설정 불완전 (emailTo 또는 smtpUser 누락) — 비활성화');
      this.config.enabled = false;
      return;
    }

    try {
      this.nodemailer = require('nodemailer');
    } catch {
      logger.warn('nodemailer 미설치 — 알림 비활성화. npm install nodemailer');
      this.config.enabled = false;
      return;
    }

    this.transporter = this.nodemailer.createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpSecure,
      auth: { user: this.config.smtpUser, pass: this.config.smtpPass },
    });

    try {
      await this.transporter.verify();
      logger.info(`알림 모듈 초기화 완료 — 수신: ${this.config.emailTo}`);
    } catch (error: any) {
      logger.error(`SMTP 연결 실패: ${error.message} — 알림 비활성화`);
      this.config.enabled = false;
    }
  }

  // ─── 이벤트 수신 메서드 ───────────────────────────────

  /**
   * Heartbeat 결과 — HeartbeatManager에서 호출
   */
  onHeartbeatResult(success: boolean): void {
    if (success) {
      this.heartbeatFailCount = 0;
      if (this.serverWasDown) {
        this.serverWasDown = false;
        this.sendAlert({
          type: 'server_recovered',
          message: '서버 연결 복구됨',
          details: '서버와의 통신이 정상 복구되었습니다.',
          timestamp: new Date(),
        });
      }
    } else {
      this.heartbeatFailCount++;
      if (this.heartbeatFailCount >= this.config.heartbeatThreshold!) {
        this.serverWasDown = true;
        this.sendAlert({
          type: 'server_unreachable',
          message: `서버 연결 불가 (Heartbeat ${this.heartbeatFailCount}회 연속 실패)`,
          details: `Heartbeat가 ${this.heartbeatFailCount}회 연속 실패했습니다.\n서버 상태를 확인해주세요.`,
          timestamp: new Date(),
        });
      }
    }
  }

  /**
   * 동기화 결과 — SyncEngine에서 호출
   */
  onSyncResult(success: boolean, details?: string): void {
    if (success) {
      this.syncFailCount = 0;
    } else {
      this.syncFailCount++;
      if (this.syncFailCount >= this.config.syncThreshold!) {
        this.sendAlert({
          type: 'sync_failed',
          message: `동기화 ${this.syncFailCount}회 연속 실패`,
          details: details || `동기화가 ${this.syncFailCount}회 연속 실패했습니다.`,
          timestamp: new Date(),
        });
      }
    }
  }

  /**
   * DB 연결 결과 — 메인 index.ts에서 호출
   */
  onDbConnectionResult(success: boolean, error?: string): void {
    if (success) {
      if (this.dbWasDown) {
        this.dbWasDown = false;
        this.sendAlert({
          type: 'db_recovered',
          message: 'DB 연결 복구됨',
          details: '고객사 DB와의 연결이 정상 복구되었습니다.',
          timestamp: new Date(),
        });
      }
    } else {
      this.dbWasDown = true;
      this.sendAlert({
        type: 'db_connection_failed',
        message: '고객사 DB 연결 실패',
        details: error || 'DB 접속에 실패했습니다.',
        timestamp: new Date(),
      });
    }
  }

  // ─── 알림 발송 ────────────────────────────────────────

  private async sendAlert(event: AlertEvent): Promise<void> {
    if (!this.config.enabled || !this.transporter) {
      logger.info(`[알림 비활성화] ${event.type}: ${event.message}`);
      return;
    }

    // 쿨다운 체크 (복구 알림은 쿨다운 없음)
    if (!event.type.includes('recovered')) {
      const lastTime = this.lastAlertTime.get(event.type);
      if (lastTime) {
        const elapsed = Date.now() - lastTime;
        const cooldown = this.config.cooldownMinutes! * 60 * 1000;
        if (elapsed < cooldown) {
          logger.debug(`[알림 쿨다운] ${event.type}: ${Math.round((cooldown - elapsed) / 60000)}분 후 재발송`);
          return;
        }
      }
    }

    try {
      const isRecovery = event.type.includes('recovered');
      const emoji = isRecovery ? '✅' : '🚨';
      const agentLabel = this.config.companyName
        ? `${this.config.companyName} - ${this.config.agentName}`
        : this.config.agentName;

      const typeLabels: Record<AlertType, string> = {
        server_unreachable: '🔴 서버 연결 불가',
        db_connection_failed: '🔴 DB 연결 실패',
        sync_failed: '🟡 동기화 실패',
        server_recovered: '🟢 서버 복구',
        db_recovered: '🟢 DB 복구',
      };

      await this.transporter.sendMail({
        from: `"Sync Agent" <${this.config.smtpUser}>`,
        to: this.config.emailTo,
        subject: `${emoji} [Sync Agent] ${event.message}`,
        html: `
<div style="font-family:'Malgun Gothic',sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:${isRecovery ? '#10b981' : '#ef4444'};color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;">${emoji} Sync Agent 알림</h2>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#6b7280;width:100px;">Agent</td><td style="padding:8px 0;font-weight:bold;">${agentLabel}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">유형</td><td style="padding:8px 0;">${typeLabels[event.type]}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">시각</td><td style="padding:8px 0;">${event.timestamp.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;">내용</td><td style="padding:8px 0;">${event.message}</td></tr>
    </table>
    ${event.details ? `<div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:4px;white-space:pre-line;">${event.details}</div>` : ''}
    <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
    <p style="color:#9ca3af;font-size:12px;margin:0;">
      이 알림은 Sync Agent에서 자동 발송되었습니다.<br>
      관리자 대시보드: <a href="https://sys.hanjullo.com">sys.hanjullo.com</a>
    </p>
  </div>
</div>`,
      });

      this.lastAlertTime.set(event.type, Date.now());
      logger.info(`알림 발송 완료: ${event.type} → ${this.config.emailTo}`);
    } catch (error: any) {
      logger.error(`알림 발송 실패: ${error.message}`);
    }
  }
}

// ─── 설정 로더 헬퍼 ─────────────────────────────────────

export function loadAlertConfig(env: Record<string, string | undefined>): AlertConfig {
  return {
    enabled: env.ALERT_ENABLED === 'true',
    emailTo: env.ALERT_EMAIL_TO || '',
    smtpHost: env.ALERT_SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(env.ALERT_SMTP_PORT || '587'),
    smtpUser: env.ALERT_SMTP_USER || '',
    smtpPass: env.ALERT_SMTP_PASS || '',
    smtpSecure: env.ALERT_SMTP_PORT === '465',
    heartbeatThreshold: parseInt(env.ALERT_HEARTBEAT_THRESHOLD || '3'),
    syncThreshold: parseInt(env.ALERT_SYNC_THRESHOLD || '5'),
    cooldownMinutes: parseInt(env.ALERT_COOLDOWN_MINUTES || '60'),
    agentName: env.AGENT_NAME,
    companyName: env.COMPANY_NAME,
  };
}
