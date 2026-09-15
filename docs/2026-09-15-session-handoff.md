# 0915 세션 인계: 로그인 세션 만료·인증 창 막힘(B-0915-1) · AI Operator 요금제 미가입 개방 + 요금제 공통 안내 창 · AI 자동제작 전 회사 개방 (2026-09-15 작성)

> 이 문서는 **다음 세션이 이어받을 자리와 Harold님 실측 순서**만 담는다. 사실·경위의 소유 문서는 아래 링크가 가진다.
> 이 세션 작업은 **전량 배포완료**(Harold 0915). 착수 첫 명령은 현재 상태 확인이다(§4). 명령마다 실행 위치를 적었다. 한 번에 하나씩 실행하고 결과를 본 뒤 다음으로 간다.

## 0. 먼저 읽을 것

1. 이 문서 전체
2. [BUGS.md](../status/BUGS.md) B-0915-1(원인 3 · 수정 · 배포 직후 로그인 실패 판정)
3. [DECISIONS.md](../status/DECISIONS.md) D90(AI Operator 요금제 개방 · 공통 안내 창) · D91(MFA IP 대역 재인증 유지)
4. AI 자동제작 축이면 [FEATURE-AI-AUTO-BUILD.md](FEATURE-AI-AUTO-BUILD.md) §4·§6·§7

## 1. 이번 세션에서 한 것

| 축 | 무엇 | 상태 | 소유 문서 |
|---|---|---|---|
| B-0915-1 로그인 | 세션 생성 만료 = 회사 `session_timeout_minutes`(24시간 폐기) · `/auth/mfa/verify` 409 응답에 신뢰 기기 토큰 동봉 · 인증번호 창이 409를 기존 인계 창으로 넘김 | **배포완료(restart 693) · 실측 대기** | BUGS B-0915-1 |
| MFA IP 대역 재인증 | 가이드라인 원문 대조(3.4 유지 조건 없음 · 3.5 "필요시 자체 기준") → Harold "규칙대로 유지" · 코드 무변경 | **결정 완료** | DECISIONS D91 |
| AI 자동제작 개방 | `aiAutoBuildEnabled`에 `*` = 전 회사 · 차감 경로 코드 점검(엔진 AI 호출 자체 차감 0 · 멱등키 102자 · 크레딧제 미적용 = 0) | **배포완료 · ENV `*` 적용 · 직원 노출 확인(Harold)** | FEATURE-AI-AUTO-BUILD §6 |
| AI Operator 요금제 개방 | 대시보드 진입 무조건(구독 만료·정지만 차단) · 허브 카드·[생성]·[이미지] = 잠김이면 공통 안내 창 · 기능 21종 원장 `constants/plan-feature-intros.ts` · 옛 PlanUpgradeModal 삭제 · 대시보드 진단 위저드·5단계 안내 분기 제거 | **배포완료 · 실측 대기** | DECISIONS D90 |
| 후속 4건 | 기능 화면 입구 `PlanGate`(15경로 · 잠김 = `/ai-operator?intro=기능id`) · 첫 진입 안내 마지막 장 "요금제 안내" · `BetaFeatureModal`·헤더 죽은 콜백 삭제 · 도움말 카탈로그 `quick-campaign` = AI 자동제작 기준 | **배포완료(Harold 빌드·reload) · 실측 대기** | DECISIONS D90 |

검증(마지막 실행): backend tsc 0 · vitest 304파일 4,702건 · frontend tsc 0 · build:safe 양쪽 · 계약 테스트 `login-issue` 3 · `login-mfa-takeover-contract` 7 · `plan-feature-modal-contract` 14 · 카탈로그 불변식 11 · 디자인 검출기(공통 안내 창 0 · 첫 진입 안내 모달은 기존 그라데이션 2 · 무변경) · harness-check 통과. Codex = UI·노출 게이트 변경이라 대상 제외(돈 경로 코드 무변경).

## 2. 실측 순서 (Harold님 · 한 번에 하나)

1. **세션 만료**: 로그인 직후(5분 안) 창 닫기 → 회사 세션 시간 + 5분 뒤 같은 브라우저로 로그인 → "사용 중" 없이 진행.
2. **인증번호 창 접속 중**: 서로 다른 네트워크의 두 브라우저에서 같은 아이디 → 뒤 브라우저 인증번호 입력 → "이미 접속 중" 창 → "기존 접속 종료하고 로그인" → 인증번호 재입력 없이 로그인 · 앞 브라우저 강제 로그아웃. 이어서 뒤 브라우저 로그아웃 후 재로그인 → 인증번호 묻지 않음.
3. **FREE 계정 허브**: 대시보드 "AI Operator" → 허브 열림 · 카드마다 "스타터부터" · 카드 누르면 그 기능 안내 창 · [요금제 보기] → 요금제 화면.
4. **FREE 계정 주소 직접**: `hanjul.ai/dm-builder` → 허브로 넘어가며 "모바일 DM" 안내 창.
5. **스타터 이상 계정**: 카드·주소 모두 표시·안내 없이 바로 이동.
6. **AI 자동제작 차감(직원 테스트 뒤)**: 새 멱등키 형태가 누를 때마다 1행.

▶ 실행 위치: .62 (한줄로 서버) · administrator 셸
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS kst, company_id, amount, source, left(idempotency_key, 80) AS idem_key FROM ai_credit_transactions WHERE idempotency_key LIKE 'quick%' AND created_at >= '2026-09-15 00:00:00+09' ORDER BY created_at DESC LIMIT 20;"
```
새 형태 = `quick:{회사}:dm:{시도토큰}:{지문16}`(이메일은 `:email:`) · 사진만 올린 경우 `quick-read:` 1행 추가. 옛 형태 `quick:{초안id}`만 계속 쌓이면 옛 화면 경로다(ENV·재기동 재확인).

7. **도움말 봇**: "AI 자동제작 어떻게 써요?" → 행사 재료·상품·[AI 자동제작]·다시 만들기 순서로 답.

## 3. 범위 밖 · 추가 과제 (착수 판단 = Harold)

- 고객사 사용자 활동 갱신이 회사 세션 시간과 무관하게 30분 고정(`middlewares/auth.ts:104`) · 세션 시간이 30분보다 긴 회사는 서버 만료가 화면 타이머보다 먼저 온다(B-0915-1 이전부터 동일).
- MFA 근거 인용 부정확: 설계서 [§4-B:155](2026-08-18-transmission-qualification-cert.md) · `utils/mfa.ts` 머리 주석(:14)·`isTrustedDevice` 주석(:150) · SCHEMA.md `mfa_trusted_devices` 행이 "3.5가 접속환경 변경 시 재인증을 명시"라고 적었으나 원문은 발신 인증의 "필요시 자체 기준" 예시(D91). 동작 영향 0.
- 삭제된 `PlanUpgradeModal`을 가리키는 주석 2줄 잔존: `components/BrandSendModal.tsx:13` · `components/DirectSendPanel.tsx:113`. 동작 영향 0 · 계약 테스트는 주석을 지운 뒤 검사해 못 잡는다.
- 요금제 표기 잔재(0915 plans 실측 = FREE만 잠김 · `auto_campaign_enabled`만 ENTERPRISE·STAFF): `utils/plan-guard.ts:435` 스팸테스트 자동화 오류 문구 "프로 요금제 이상"(실제 STARTER부터 · 받는 쪽은 FREE뿐) · `:50` 주석 "auto_campaign — PRO+"(판정은 FREE 여부) · 요금제 추천(`plan-recommend.ts:101`)이 `auto_campaign_enabled`를 요구하는 활성 진단 문항이 있으면 ENTERPRISE를 추천(활성 문항 여부 미확인).
- 전체 테스트 첫 실행에서 `__tests__/audit-action-labels.test.ts` 1건 실패(recordAuditLog 추출 0) · 단독·전체 재실행 통과 · 원인 미확인.
- 0914 3세션 미실측(알림톡 예약·취소·분할 · 주소록 0) = [0914 인계 §6](2026-09-14-session-handoff.md).

## 4. 다음 세션 첫 명령 (현재 상태 확인)

▶ 실행 위치: .62 (한줄로 서버) · administrator 셸
```bash
cd /home/administrator/targetup-app && git log --oneline -3; grep -c "expiresInMinutes: sessionTimeoutMinutes" packages/backend/src/utils/login-issue.ts; grep -c "list.includes('\*')" packages/backend/src/utils/ai-auto-build-materials.ts; grep -c "PlanGate featureId" packages/frontend/src/App.tsx; grep '^AI_AUTO_BUILD_COMPANY_IDS=' packages/backend/.env
```
기대 = 1 · 1 · 15 · `AI_AUTO_BUILD_COMPANY_IDS=*`.
