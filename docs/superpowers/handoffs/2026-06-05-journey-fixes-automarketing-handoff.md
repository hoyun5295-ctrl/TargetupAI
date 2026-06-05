# 2026-06-05 핸드오프 — 여정 결함 11건 fix(배포) + 자동마케팅 점검 + 자율발송 설계

## 이번 세션 결과

### A. 여정 엔진 결함 11건 fix — 전부 구현·검증, 배포(Harold)

설계 문서(`docs/superpowers/specs/2026-06-04-journey-engine-redesign-design.md`) 대조 전수 점검 → 어긋난 11건 정정. 백엔드 tsc 0 · 여정 순수 테스트 127건 green · 박-단어 0.

1. 발송·재진입에 공통 안전필터 적용(`isCustomerSendable` + reentry buildJourneySafetyFilter) — 진입 후 수신거부·무효번호 차단
2. 휴면·생일·포인트 진입 안티조인(`buildReentryAntiJoin`) + 워처 cap+1 — 501명+ 누락·대량차단기 무력화 해소
3. 목록 status SQL 주입 차단(`journey-list-filter` 화이트리스트)
4. 활성화 전 문안 검증 강제(`journeys.last_pretest_passed_at` 마커 게이트 + 503 안전망) — ALTER 실행 완료
5. 정지 레이스 차단(executor statusCheck가 journey.status까지 확인) + 무효 UPDATE 제거
6. **전원 진입(원래 의도)** — 추출 LIMIT 제거(JOURNEY_COUNT_CAP) + 한 방 일괄 INSERT(루프 폐기) + 장바구니 재진입 안티조인 추가
7. 검증 비용 회사 실단가로 교체(임의상수 제거)
8. 죽은 resumeJourney 제거(함수+endpoint+import)
9. step 지연 상한 8760h 통일
10. wait delayMode에 relative_at_hour 추가
11. cdp 커서 LIMIT 누락 정정(`planCdpCursorBatch` — 마지막 처리 이벤트 시각까지만 전진)

신규 순수 모듈 TDD: journey-safety-filter(isCustomerSendable·buildReentryAntiJoin) / journey-list-filter / journey-cdp-cursor.

설계 문서 대조 결과 = §3~§12 코드 반영 확인. 방식 차이 3건(의도는 충족):
- §6 LIMIT — "제거" 대신 일괄 INSERT 전원 진입(6번에서 원래 의도대로 재구현)
- §7 staging — campaign 공유 + 멱등 가드(executor 점증 처리라 staging 불필요)
- §11 활성화 — 동기 재테스트 대신 마커 게이트(검증 통과해야 활성화, 504·이중과금 회피)

### B. 자동마케팅(Continuous Operator) 점검 — 결함 도출

| # | 결함 | 라인 | 심각도 |
|---|---|---|---|
| 1 | **자동실행(auto_executed) 실발송 코드 없음** — 크레딧만 차감, 미발송 | continuous-operator:593 / markProposalExecuted 호출 0 | CRITICAL |
| 2 | 타겟 카운트·발송 안전필터 미흡 — is_opt_out·is_invalid 누락 + 수신거부 user_id | services/ai.ts:2282 | HIGH(여정 #1과 동일) |
| 3 | 검증기간 자동실행 차단 불완전 — auto_executed 플래그만 false, status 유지 → 차감 | continuous-operator:580 vs 593 | HIGH |
| 4 | compliance 검수 에러 시 passed=true fallback → 자동실행 자격 | ai-orchestrator:280 | MEDIUM |
| 5 | 수동 승인 차감↔발송 분리(원자성 없음) | continuous-operator:763 | MEDIUM |
| 6 | 죽은 코드(spamTestWithRetry + 가짜 SPAM_WORDS 점수) | continuous-operator-policy:166~365 | LOW |
| 7 | listProposals status 보간(라우트가 화이트리스트로 막아 주입 불가, 방어 강화 권장) | continuous-operator:724 | LOW |

→ Harold 확정: 1번(실발송)은 명백한 문제. 자동발송 의도 = 매달 계절 문안 AI 생성 + 조건 타겟 자동추출 + 테스트 후 자율 발송(여정과 비슷한 2h 전 테스트·스팸·정지·알림).

### C. 자동발송 설계서 작성 — 다음 세션 구현 대상

`docs/superpowers/specs/2026-06-05-continuous-operator-autosend-design.md` 작성(brainstorming 완료). 발송 메커니즘 = 직접발송 파이프라인 재사용. 한 사이클 = T−2h 준비(생성·스팸2회재생성·담당자 테스트/알림) + T 자율 발송. 스팸 2회 실패 → 운영자 정지+사유 알림 / 0건 → 스킵. 첫 달부터 자율. **§6에 비토 질의 10건(계절소스·주기·테스트발송정의·정지창·수동UI·완료통지·예산·objective결합·마이그레이션·프론트).**

---

## 다음 세션 진입 명령어

```
CLAUDE.md 0번 원칙 + 추측SQL금지(첫 SQL 순수 덤프) + information_schema 선검증 + 순수 로직 TDD 정독 →
status/lessons/LESSONS_BACKEND.md 2026-06-05 블록 + memory/project_2026_0605_session7_journey_automarketing.md 정독 →
docs/superpowers/specs/2026-06-05-continuous-operator-autosend-design.md 정독(자동발송 설계 + §6 질의 10건) →
§6 질의 10건부터 Harold 확정 받고 → §8 information_schema 선검증 SQL 제공 → §7 구현 순서대로(1 안전필터 통일 → 2 sendCampaignDirect 추출 → 3 scheduled_send_at ALTER → 4 워커 2단계 → 5 스팸실패정지/0건스킵 → 6 검증제거·죽은코드·compliance정정 → 7 계절문안 → 8 프론트) TDD 구현.
코드만(배포 Harold). 여정 11건은 배포 완료 — 손대지 말 것.
```

## 미해결/주의

- 자동마케팅은 **실발송이 빠진 채 크레딧만 차감**하는 상태 — ENT가 자동실행을 켜둔 회사가 있으면 운영 피해(차감·미발송). 다음 세션 1순위로 §6 질의 → 구현. (켜둔 회사 있는지 Harold 확인 권장.)
- 여정 #6(전원 진입)으로 같은 시각 대량 코호트는 executor가 회차당 100건씩 발송 = 트리클. 큰 무리 동시 발송이 필요하면 별도 논의(staging/executor 처리량 상향).
