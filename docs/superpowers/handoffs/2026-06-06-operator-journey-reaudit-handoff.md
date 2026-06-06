# 2026-06-06 핸드오프 — 자동마케팅 + 여정 엔진 다시 전수 재점검 (다음 세션)

## 이번 세션 결과 (전부 배포 완료)

### A. 자동마케팅(Continuous Operator) 점검 → 정정
- A 정지복구: reviewed_at(auto claim) + dispatchProposalSend 커밋 전 try/catch→admin_review + campaign_id 마커 + reconcileStuckSending(runAutoSendPass) + 순수 decideStuckSendingRecovery.
- B 광고080 가드(자격 + 발송 직전). D listProposals 파라미터화 + 라우트 validStatuses 6 추가. E markProposalExecuted 제거. F 프론트 죽은 검증/옵트아웃 UI 제거·카피·누출단어 정리.
- **C 게이트 미결**: cdp_auto_execute_enabled 설정 화면·API 부재(DB 전용). 자가-서브 토글 vs 베타 DB 전용 = Harold 의도 미정.

### B. 여정 엔진 재점검 → 정정
- J1 차감↔발송 원자성: 발송 성공 시점 차감(큐 앞 read-only 사전확인 / 큐 성공 직후 멱등마커 'sent'→차감 / 미발송 경로 비용 0).
- J2 budget_monthly: 이번 달 journey_step_logs 실발송 비용 합으로 교정.
- J3 변이 통계: journey-stats가 bandit_alpha/bandit_beta/variant_id 읽게 별칭 교정.
- 2시간전 스캐너: journey callback_number 전달(오탐 정지 방지).

상세 = memory/project_2026_0606_operator_journey_audit_fixes.md.

## 다음 세션 = 다시 전수 재점검

배포 후, 이번 정정이 회귀 없이 유지되는지 + 남은 결함을 전면 재점검. 추측 금지 — 소스 직접 읽고, DB 필요 시 information_schema 선검증. 결함 시 통합 정정(코드만, 배포 Harold).

### 회귀 확인 (이번 정정분)
1. **여정 J1** — message step 발송: 큐 성공 직후에만 차감되는지, 큐 실패·발신무효 시 차감 0인지, 재시도가 멱등 마커(step_log 'sent')로 중복발송/중복차감 안 되는지. 발송 1건 = balance_transactions deduct 1건 = step_log 'sent' 1건 정합.
2. **여정 J2** — budget_monthly 설정 여정이 당월 누적만으로 정지되고 다음 달 리셋되는지.
3. **여정 J3** — 여정 통계 화면의 변이 사후확률/평균 클릭률이 실제 발송·클릭 반영하는지(0.5 고정 아닌지).
4. **2시간전 스캐너** — journey callback으로 스팸 재검이 enqueue·발송되는지(오탐 정지 0).
5. **자동마케팅 A** — claim 후 예외 시 'sending' 영구 정지 없는지(admin_review 전환 / reconcile). B 광고080 미설정 시 보류. D 목록 신규 상태 조회.

### 남은 결함·미결 (다음 세션 처리)
- **C 게이트 결정** — cdp_auto_execute_enabled 설정 위치: ① 슈퍼관리자 토글 ② 회사 admin 자가설정 ③ 베타 DB 전용 유지. Harold 의도 확인 후 진행.
- pause token 시크릿 — `JOURNEY_PAUSE_TOKEN_SECRET` 운영 env 설정(코드 X).
- 진단 expand_send_hours 1-click — executor 발송시간 8~21 고정. 라우트 핸들러가 실제로 바꾸는지(per-journey 발송시간 override 존재 여부) 확인.
- 목록 status 보간(화이트리스트라 안전)·재진입 첫 step 지연(표준 무영향) = 현 동작 유지(필요 시 방어차원만).

### 신규 결함 점검 영역 (지난 점검 외)
- 발송결과/통계 화면에 여정·자동마케팅 campaign 정상 표시(app_etc1·result_final·sync).
- 카카오/알림톡 채널 여정 발송 경로(insertAlimtalkQueue·템플릿 승인 가드).
- Liquid/Connected Content/Predictive enrich 실패 시 발송 차단 0(안전 fallback) 재확인.

## 세션 진입 명령어

```
CLAUDE.md 0번 원칙(추측SQL 금지=첫 SQL 순수 덤프·미확인 컬럼0·스키마필터0) + db_column_verify_before_code(information_schema 선검증) + 3원칙(자가진단·클로드원칙·슈퍼파워즈 스킬) + 순수 로직 TDD + 코드만(배포 Harold) 정독.

정독 순서:
1. status/lessons/LESSONS_BACKEND.md 2026-06-06 블록 + status/lessons/LESSONS_META.md (답변 패턴)
2. memory/project_2026_0606_operator_journey_audit_fixes.md (이번 정정 전체)
3. docs/superpowers/handoffs/2026-06-06-operator-journey-reaudit-handoff.md (본 문서 — 회귀 확인 + 미결)

작업 = 자동마케팅(Continuous Operator) + 여정 엔진 전수 재점검.
- [승인 요청] 소스 grep/Read 후 배포된 이번 정정(자동마케팅 A/B/D/E/F + 여정 J1/J2/J3/2h-callback)이 회귀 없이 유지되는지 + 남은 결함이 있는지 전수 재점검.
- 결함 시: 검증된 사실(grep/SQL) → 동일 패턴 전수 grep → information_schema 선검증 → 통합 정정안 1개 → 동의 → 한 건씩 구현.
- ★ 배포분 회귀 주의. C 게이트 설정(슈퍼관리자 토글 / 회사 admin 자가설정 / 베타 DB 전용) Harold 의도 먼저 확인.
```
