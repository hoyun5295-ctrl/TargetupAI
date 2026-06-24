/**
 * ★ D69+AI Premium: 자동발송 PM2 워커 (4단계 라이프사이클)
 *
 * 실행 방식: app.ts 내부 setInterval (매 1분, 정각 align)
 *   - 워커 시작 시 다음 분의 0초까지 대기 후 첫 실행
 *   - 이후 60초 간격으로 반복
 *   - 정각 발송 설정(예: 11:00)이 최대 60초 이내에 잡히도록 보장 (B7 fix)
 *
 * ★ 4단계 라이프사이클 (AI 문안 자동생성 지원):
 *   D-2 23:00  → runMessageGeneration()  — AI 문안 생성 + 담당자 알림
 *   D-1        → runPreNotification()    — 담당자에게 사전알림
 *   D-day 2h전 → runPreSendSpamTest()    — 스팸테스트 + 결과 알림
 *   D-day      → executeAutoCampaign()   — 실제 발송
 *
 * 기존 파이프라인 100% 재활용:
 * - customer-filter.ts (CT-01) → 타겟 필터링
 * - unsubscribe-helper.ts (CT-03) → 수신거부 제외
 * - sms-queue.ts (CT-04) → MySQL 큐 INSERT
 * - messageUtils.ts → 변수 치환
 * - prepaid.ts (CT-05) → 선불 차감
 * - services/ai.ts → AI 메시지 생성 (generateMessages)
 * - spam-test-queue.ts (CT-09) → 자동 스팸테스트/재생성
 * - target-sample.ts (CT-A, B5) → 타겟 첫 고객 조회 (스팸테스트 개인화)
 * - auto-notify-message.ts (CT-B, B6) → 담당자 알림 메시지 빌더
 *
 * 실패 정책: 스킵 + failed 기록 → next_run_at 다음 스케줄로 갱신 (중복 발송 방지)
 */
/**
 * ★ D111 E2: next_run_at 계산 컨트롤타워
 *
 * 이전: auto-campaigns.ts(routes)와 auto-campaign-worker.ts(utils) 2곳에 동일 로직 중복 →
 *       한쪽 수정 시 불일치 → 발송 시각 오차 재발 위험.
 * 이후: utils에 export — routes가 import해서 사용. 유일한 진입점.
 *
 * 로직:
 * - 서버 타임존에 관계없이 KST 기준으로 다음 실행 시각 계산
 * - Date.UTC + KST_OFFSET_MS 보정 (D83 — 이중변환 방지)
 * - daily: 오늘 시각이 지났으면 내일
 * - weekly: 이번 주 요일이 지났으면 다음 주
 * - monthly: 이번 달 날짜가 지났으면 다음 달
 */
export declare function calcNextRunAt(scheduleType: string, scheduleDay: number | null, scheduleTime: string): Date;
export declare function kstToUtc(kstDate: Date): Date;
export declare function runAutoCampaignWorker(): Promise<void>;
export declare function startAutoCampaignScheduler(): void;
//# sourceMappingURL=auto-campaign-worker.d.ts.map