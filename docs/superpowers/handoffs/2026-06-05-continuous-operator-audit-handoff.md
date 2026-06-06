# 2026-06-05 핸드오프 — 자동마케팅(Continuous Operator) 코드 전수 점검 (다음 세션)

## 이번 세션(세션8) 결과 — 자율 발송 구현 완성 (미배포)

자동실행이 크레딧만 차감하고 실발송 코드가 전무했던 CRITICAL 결함을 해소하고 자율 발송을 전 구현. backend·frontend tsc 0 · 순수 38 assertion green · 박/모델명/native dialog 0.

- 신규 CT 5종: season-context · operator-recipients · direct-send-spec · direct-send-core · autosend-policy.
- prep(schedule_time 도달) = 계절 문안 생성 → 스팸 2회 재생성 → 통과 시 status='scheduled' + scheduled_send_at = now+lead + 담당자 실문안/정지안내.
- 발송 패스(scheduled_send_at 도달) = 타겟 재추출(안전필터) → staging → createDirectSendCampaign(직접발송 공유) → 크레딧 멱등(continuous-operator-send:proposalId) → status='sent' + campaign_id + 완료통지.
- 스팸 끝내 실패 → operator 'paused' + 알림 / 0건·잔액 → skip + 알림 / 정지창(adminStopProposal이 'scheduled' 허용).
- 안전필터 통일(buildJourneySafetyFilter), compliance fail-closed(passed=false), 검증 7일 제거, 예산 집계 'sent' 추가, 광고성 허용(adEnabled=isAd), 수동 승인 원자성(dispatchProposalSend 공유), lead 설정 UI.
- ALTER 완료(Harold): operator_proposals.scheduled_send_at · continuous_operators.auto_send_lead_minutes.
- 상세 = `memory/project_2026_0605_session8_autosend_backend.md`.

## 다음 세션 = 자동마케팅 코드 전수 점검

배포 후, 자율 발송 + 기존 자동마케팅 코드를 전면 점검한다. 추측 금지 — 소스 직접 읽고, DB 필요 시 information_schema 선검증. 결함 발견 시 통합 정정(코드만, 배포 Harold).

### 점검 체크리스트

1. **상태기계 무결성** — pending / scheduled / sending / sent / skipped / admin_review / admin_stopped / approved / rejected / expired / auto_executed(레거시) 전이 전수. ★특히 `sending` claim 후 dispatchProposalSend가 예외로 throw하면 'sending'에 stuck될 수 있음 — balance/발송오류는 admin_review로 내리지만, 그 외 query 실패 등 예외 경로 점검. stuck 'sending' 복구(타임아웃 워커)가 필요한지 판단.
2. **타이밍** — prep(next_run_at<=NOW) → scheduled_send_at=now+lead → 발송 패스. next_run_at 전진(computeNextRun)으로 같은 사이클 재prep 없음 검증. 서버 다운으로 사이클을 놓쳤을 때(missed cycle) 동작. lead 의미(설정 시각=준비, 발송=+lead) 프론트 표기 일치.
3. **크레딧 원자성** — continuous-operator-send 멱등(proposalId) + prepaidDeduct(SMS, sendCampaignDirect 내부). 자동·수동 둘 다 발송 성공 시점만. 중복 차감/누락/롤백 점검. createDirectSendCampaign이 prepaidDeduct 실패 시 campaign DELETE + DirectSendError(402) — 그 흐름 검증.
4. **안전필터** — 발송 시점 재추출(buildSendableRecipientsSql) + direct-send-worker의 user_id 기준 unsub DELETE 중복(자율은 회사+전화로 이미 걸러 무해하나 확인). is_opt_out·is_invalid·회사+전화 일관. countFilteredCustomers unsubscribeCount(정보용) 일관.
5. **광고성** — adEnabled=isAd → (광고)/080 합성(direct-send-worker getOpt080). ★080 미설정 회사가 ad 발송 시 무료거부 누락 위험(정보통신망법) — 발송 전 080 존재 가드가 필요한지 점검. 스팸테스트(autoSpamTestWithRegenerate buildAdMessage)와 발송 본문 일치(D230+).
6. **변수 치환** — staging에 phone+name만 적재 → %고객명%만 resolve. 다른 변수(%포인트%·custom_fields) 쓰는 메시지의 cleanLeftoverVars 처리·미리보기 점검. 필요하면 extra1~3 매핑 확장 검토.
7. **게이팅** — cdp_auto_execute_enabled 설정 위치(어느 화면에서 켜는지) + 임계값(max_recipients·max_cost·max_risk) + plan_code(ENTERPRISE/BUSINESS). 켜둔 회사 현황 확인.
8. **수동 승인 UX 변경** — 승인 = 즉시 백엔드 발송으로 바뀜. admin_review(스팸 미통과) 승인 시 스팸 본문이 발송되는 것(의도된 운영자 override)인지 확인. 프론트 handleApprove 흐름·문구.
9. **목록/통계/결과** — listProposals 'scheduled'/'sent'/'skipped' 표시 + 예산 집계 status IN. 자율 발송 campaign(source 식별)이 발송결과 화면에 정상 표시되는지(app_etc1·result_final).
10. **운영 실측(Harold 영역)** — operator 1건 + cdp_auto_execute on + 짧은 lead로 end-to-end 발송 1회 관찰.

### 세션 진입 명령어

```
CLAUDE.md 0번 원칙(추측SQL 금지=첫 SQL 순수 덤프·미확인 컬럼0·스키마필터0) + db_column_verify_before_code(information_schema 선검증) + 순수 로직 TDD + 코드만(배포 Harold) 정독.

정독 순서:
1. status/lessons/LESSONS_BACKEND.md 2026-06-05 세션8 블록 + status/lessons/LESSONS_META.md (답변 패턴)
2. memory/project_2026_0605_session8_autosend_backend.md (자율 발송 구현 전체)
3. docs/superpowers/handoffs/2026-06-05-continuous-operator-audit-handoff.md (본 문서 — 점검 체크리스트 10항)

작업 = 자동마케팅(Continuous Operator) 코드 전수 점검.
- [승인 요청] 소스 grep/Read 후 상태기계·타이밍·크레딧 원자성·안전필터·광고성/080·변수치환·게이팅·수동승인·목록통계 10항 전수 점검.
- 결함 발견 시: 검증된 사실(grep/SQL) → 동일 패턴 전수 grep → information_schema 선검증 → 통합 정정안 1개 → Harold 동의 → 구현.
- ★ 세션8 자율 발송 코드는 배포분 — 회귀 주의. 여정 엔진은 손대지 말 것.
```
