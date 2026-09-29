# 여정 V2 마스터 여정 설계서 (2026-09-29)

> **호출어: "여정 V2" · "마스터 여정" · "생애 지도"** — 이 문서가 V2의 결정·차수·구현 기록을 소유한다.
> 여정 기능 상설 SoT = [FEATURE-JOURNEY.md](FEATURE-JOURNEY.md) (불변 원칙 §2 · 파일별 소유 §3). 여기는 V2 변경분만 적는다.

---

## 0) 한 줄 정의 · 발단 · 결정 경위

**여정 여러 개를 생애 흐름 한 장(생애 지도)에서 보고, 그 위 칸을 눌러 바로 고치고, 문장 하나로 흐름을 설계하는 여정.**
실행 단위는 계속 "여정 하나 = 트리거 하나"다. 여정 사이 선은 저장하지 않고 설정에서 계산해 그린다.

- 발단(Harold 0929): Braze · 국내 후발 AI 마케팅 업체의 흐름도(가입 3통 → 첫 구매 → 2차 구매 독려 3회 → 상품별 재구매 1개월 · 2달)를 예시로
  "전체 흐름을 보면서 칩을 붙이는 설계 · 예쁘고 이해 쉬운 흐름도 · 방대해지는 도식 · V2 업그레이드" + "현재 여정 단점까지 심층분석해서 완벽한 V2 마스터여정".
- 추가 요청(Harold 0929): ① 만들어 둔 여정을 보고 **부족한 여정을 추천**하는 버튼 + 모달 ② **"XXX 여정 만들고 싶은데 도와줘"** → 질문(선택지 · 직접 입력) → 설계 → **진행 중 여정에 이어붙일 곳 점검**.
  배경 = 여정을 유료로 쓰는 고객사가 아직 0 → **그 전에 완벽히 대비**한다.
- 경위: COLLAB §1 회의(기획 · 프론트엔드 · 디자이너 · 백엔드 · 회의론자) 1차 의견 → 교차 토론 → 회의론자 최종 검증 + 4역할 수용 확인
  → 전원 "조건부 이거면 됩니다" → 조건 전부 반영 → Harold 승인 "추천대로 진행해 · 0차부터 끝까지 구현".

## 1) 현재 여정 단점 — 8개 뿌리 (코드 근거는 회의 원문 · 주재자 확인분 표기)

| # | 뿌리 | 심각도 | 무엇이 문제인가 | 대표 근거 |
|---|---|---|---|---|
| 1 | 보이는 것 ≠ 저장 ≠ 실행(전부 "더 보내는 쪽"으로 샘) | 치명 | 비프리셋 마케팅 저장은 트리거 · 조건을 보내지 않아 템플릿 기본값(`cdp.purchase` · `{}` / `custom` · `{}` = 전 고객)으로 저장 · 모르는 조건 필드는 조용히 버림 · 모르는 칸 종류는 생성 경로에서 **그대로 저장**(builder:289)되거나 **문자로 바뀌고**(builder:537 · ai-editor:56) 실행기는 모르는 값을 문자로 발송 · 운영 중 자동 종료 끄기 무검사 | `JourneysPage.tsx:1593-1611` · `journey-target-extractor.ts:881-886`(주재자 확인) · `journey-builder.ts:289·537` · `routes/ai.ts:4155-4163` |
| 2 | 여정 사이 관계가 엔진에도 화면에도 없음 | 치명 | 세로 목록 · 하나만 펼침 · 선 · 겹침 · 넘어간 인원 없음 · 다음 수 카드는 세션 한정 첫 간선만 | `JourneysPage.tsx:553 · 1787` |
| 3 | 여정 간 동시 진행 통제 없음 | 치명 | 첫 구매 1건이 첫 구매 · 주문 완료 두 여정을 시작 · 겹침 선언 한 쌍뿐 · 피로도 걸린 칸 영구 소실 | `journey-trigger-capability.ts:186-190` · `journey-executor.ts:690-699` |
| 4 | 상품 축 없음 | 치명 | 상품 여정 불가 · 상품 조건 조용히 버림 → 전체 발송 · 목표 = 아무 구매 · 같은 여정 active면 새 구매 진입 삼킴 | `journey-trigger-watcher.ts:584·605-608` · `journey-executor.ts:1531-1560` |
| 5 | 같은 사실의 사본이 여러 벌 | 큼 | 자동 종료 기본값이 경로마다 다름 · AI 트리거 7종 vs 레지스트리 13 · 흐름도 "skip" vs 실행기 종료/점프 · 통계 번호 +1 · 구매 판정 자리마다 규칙 다름 · 퍼널 색 임계 2벌 · 시간 표기 3벌 | `journey-ai-generator.ts:267-275` · `JourneyFlowDiagram.tsx:189-199` · `JourneyStatsPage.tsx:244` |
| 6 | 분기가 반쪽 | 큼 | 충족 갈래 흘러내림 · 끝 칸 없음 · 조건 3종 중 2종 저장 불가(죽은 컨트롤) · 안내 문구 반대 · AI 수정이 분기 필드를 버리고 대기를 720h로 자름 | `JourneysPage.tsx:486-489 · 3037-3039` · `journey-ai-editor.ts:55-100` |
| 7 | 판정 시점이 발송 시각에 묶임 | 큼 | 목표 판정이 due 때만 → "지금 N명" · 겹침 부풀림 | `journey-executor.ts:184-208·355` |
| 8 | 화면 구조 부채 | 큼 | 3,940줄 · 상태 71 · 편집 입구 6 · 초안 비영속 · 빈 화면 예시 무동작 · 내부 용어 · 사전검사 칸당 30초 동기 대기 | `JourneysPage.tsx` · `journey-pretest-validator.ts:302` |

- **도식 워크스루 막힘 6** → ①가입→첫 구매 선(자동 종료 기본 꺼짐) = 0차(기본값) · 1·2차(새는 선 + 이어 주기) ②첫 구매 1건에 두 여정 = 0차 ③자연어가 첫 구매에 못 닿음 + 저장 유실 = 0차 ④상품 여정 불가 · ⑥같은 상품 재구매 종료 불가 = 3차 ⑤30일 넘는 단일 대기 AI 불가 · 수정기 절단 = 0차.
- **운영 실측(0929 Harold 실행)**: 보관 제외 18개 = 활성 1 · 멈춤 2 · 끝남 2 · 초안 13. 자동 종료 켜짐 1(장바구니)뿐. 이름은 대상이 좁은데 저장은 `custom` + `{}`인 행 7(활성 1 포함 · 원인 = 뿌리 1과 같은 모양, AI 원 제안은 미기록이라 미검증). 알림톡 여정 3이 `repeat` 템플릿으로 저장. **유료 사용 고객사 0**(Harold).
- **지킬 자산**: 불변 원칙 8줄 · 활성화 단일 게이트 + 수신자 상한 · 커서 · 원장 · 이어달리기 계약 간선 · goal_met + `current_step_order` · JourneyStepStudio · JourneyModalShell · capability(데이터가 여는 트리거) · 원스텝 인터뷰 CT 방식.

## 2) 불변 원칙 — FEATURE-JOURNEY §2에 9번째 줄 추가

> **다른 여정으로 고객을 자동으로 옮겨 넣지 않는다. 같은 여정에 다시 들이는 것(구매 없이 N일마다 다시 태우기)은 담당자가 명시적으로 켠 경우만.**
> 빠지기(목표 달성 종료)는 자동이어도 된다. 넘어가는 선 = A 목표 종료 + B 자기 트리거 정상 진입(동의 · 상한 · 소급 금지 그대로).

- 비교(공식 문서 WebFetch 확인): Braze Send to Destination은 도착 캔버스의 행동 진입 조건 · 예약 진입을 건너뛰고 원래 캔버스도 계속 진행한다(오디언스 조건 · 재진입 설정은 지킴). 우리는 이 모양을 택하지 않는다.
- 재진입 어휘 두 축: **"다음 구매 때 다시 받기"** = `allow_reentry` · **"구매 없이 N일마다 다시 태우기"** = `auto_reentry_enabled`. 프리셋 · AI 초안 · 상품 프리셋은 `auto_reentry_enabled=false`를 서버가 고정한다.

## 3) 화면 구조 (3단)

- **생애 지도(1단)**: 레인 = 열(가입 · 첫 구매 · 재구매 · 상품 재구매 · 이탈·복귀) · 아래 띠 "언제든 생기는 순간"(장바구니 · 조회 후 미구매 · 배송 · 생일 · 등급 · 포인트) · 맨 아래 "상시 · 날짜 예약 · 정보 알림(읽기 전용)".
  레인 키 = 서버 `lifecycle-map`이 `(start_kind, trigger_event)` + 정보 알림 분류(메시지 칸 전부 kakao + is_ad=false)로 정한다. 레인 목록 = 계약 `lane` 필드(카탈로그 미러 · parity: 모든 트리거 = 레인 하나).
  카드 펼침 = 칸이 아래로(옆 열 불변). 레인 안 정렬 = 켜짐 → 멈춤 → 초안 → 끝남 · 초안 · 끝남은 한 줄로 접힘 · 상태 필터 · 검색 · 유령 카드 레인당 1.
- **여정(2단)**: 칸 모양 = 문자 · 대기 · 갈림 · 끝 · D+N(서버 `timingLabel`) · 칸 사이 "구매 확인 N"(= goal_met `current_step_order` 분포, journey-graph가 해석).
- **칸 서랍(3단)**: 편집 입구 하나. 문자 칸 = JourneyStepStudio `layout='stacked'` + 단일 칸 모드(자체 내비 숨김 · 시간 라벨 서버 · 잠금 서버) · 알림톡 · 날짜축 칸 = 1~2차 읽기 전용 + [기존 편집 열기].
- **선**: 계약 간선(`nextEvents` + 3차 상품 간선)에서만 · 자유 선 긋기 0 · 좌표 · 선 저장 0. 상태 = 서버 사유 코드(연결됨 / 새는 선(A 자동 종료 꺼짐) / 받는 여정 없음 / 받는 여정 꺼짐·초안·잠김 / 끊김(재진입 막힘 · 이미 잡고 있음)).
  시각 3종: 보라 실선(이어짐) · 호박 점선 + 사유 한 줄 + 고치기 1클릭 · 흰 점선(비어 있음 · 유령/자물쇠). 겹침 = 짝 배지(누르면 두 카드 포커스 + 해소).
- **숫자**: "구매 확인 N"(A goal_met) · "이어받음 M" = 같은 고객 · B 진입 사건 시각 ∈ (A 목표 신호 시각, +24h] · 같은 사건으로 A · B 동시 진입 제외 · 재진입 워커 진입 제외 · 표식 없는 옛 행 = "측정 전" · 0 = "아직 넘어간 고객 없음 · 켠 날부터 셉니다" · 인과 주장 안 함. B 카드 "전체 진입 X(holdout 제외) 중 이 선에서 온 M".
- **색 사전**: 지도 전용 토큰 파일 — violet = 이어짐 · 문자 칸 / amber = 손봐야 함 전용 / 대기 = slate / 갈림 = cyan / 목표 = emerald / 끝 = white/10 / 겹침 = rose. 선 모양 · 아이콘을 2차 단서로. 범례 한 줄 상시.
- **폭**: 1280 이상 = SVG 선 · 1024~1279 = 가로 스크롤(레인 머리 고정) · 768 미만 = 레인 접기 + 카드마다 "다음 → ○○ 여정 · 이어받음 M" 줄 + 하단 시트. 실측 폭 1440 · 1024 · 768 · 360.
- **화면 하한**: slate-950 + violet(OUI_ 토큰 · OPERATOR_PAGES 등재 · 캔버스 뷰) · 글자 11px 이상(Source caption은 기존 불변식 예외) · 문구 사전 + grep 불변식(영문 식별자 · 내부어 · 모델명 · 줄표 0) · 5초 넘는 작업 = 로딩 표시 + 닫기 = 취소 · 커스텀 모달 · 움직임 = 최근 7일 이어받음 > 0인 선만 흐름(reduced-motion 정지).
- 새 lazy 페이지 · 옛 목록은 [지도 | 목록] 전환으로 동작 무변경 병존 · 첫 화면 전환은 실측 뒤 Harold 결정 · 배포 관문에 `scripts/verify-live-chunks.sh`.

## 4) 서버 CT (화면은 그리기만 · 의미 추론 코드 0줄 · 기하만 화면)

| CT | 파일 | 소유 |
|---|---|---|
| 계약 확장 | `journey-trigger-capability.ts` | `lane` · `label` · `exclusiveEvents` · 구매 스트림 표시 · `defaultGoalExit`/`goalKindFor` 파생 · 받는 쪽 재진입 필요 · 상품 트리거(3차) |
| 칸 한도 | `journey-step-limits.ts`(신규 · 0차 완료) | 0차 = 전체 칸 7(`MAX_JOURNEY_STEPS` · 현행 의미) · 4차에 문자 칸 7 + 전체 상한으로 전환 · `MAX_STEP_DELAY_HOURS=8760` · 칸 종류 화이트리스트 · 모르는 값 = 거부 · 넘치면 자르지 않고 거부 |
| 조건 검증 | `journey-target-extractor.ts` | `validateCustomerConditions` — 추출기의 허용 필드 · 연산자와 같은 목록(단일 출처) · 저장 · 활성화가 거부 |
| 그래프 | `journey-graph.ts`(신규 · 순수) | 칸 행 → 노드 · 간선(다음 · 예/아니오 · 끝) · 출구 · `current_step_order` 해석. 흐름 그림 · 지도 · 저장 검증 · 실행기 테스트가 같이 읽음 |
| 목표 신호 | `journey-goal-signal.ts`(신규) | `resolveGoalKind`(저장값 → 계약 파생) · 실행기 `isGoalConvertedSinceEntry` 이전 + 동작 동일 테스트 · 지도 읽기 판정 집합 SQL |
| 생애 지도 | `journey-lifecycle-map.ts`(신규) | 단일 조회: 여정 · 레인 · 칸 · 선 상태 · 선 숫자 · 칸별 출구 · 겹침 · 잠금 · 경고 · 비용 · 판정 시각. 읽기 판정은 캐시 · 늦게 채움 |
| 빈 곳 찾기 | `journey-opportunities.ts` 확장 | 지도 + 실측 기회(여정 종류 구분 = trigger_event · template_code 오차단 정정) · AI 호출 0 |
| 인터뷰 | `journey-interview.ts`(신규 · 순수) | 질문표 · 보이는 질문 · 답 검증 · 추천 답 · 결정값 — AI · DB 호출 0(원스텝 인터뷰 CT와 같은 방식) |
| 이어붙이기 점검 | `journey-lifecycle-map.ts` | 한 여정(초안 포함) 기준 들어오는 선 · 나가는 선 · 같이 시작 · 같이 만들면 좋은 곳 |
| 켜기 묶음 | `journey-builder.ts` | `activateJourneysInOrder` — 받는 여정 먼저 · 여정별 기존 `activateJourney` · 결과 묶음 · 겹침 해소 확인 |

## 5) 빈 곳 찾기 · 문장으로 만들기

- **빈 곳 찾기(1차)**: 지도 머리 [빈 곳 찾기] → 모달 4묶음 = 비어 있는 구간(실제 대상 수 · 관련 매출 · [바로 만들기] 1클릭 초안 / [질문 받고 만들기]) · 새는 선([이어 주기]) · 겹침([해소 고르기]) · 데이터가 있어야 열리는 여정(필요 연동). AI 호출 0 · 무과금 · 숫자 = DB 실측.
- **문장으로 만들기(2차)**: 입력 → ①해석(AI 1회: 시작 사건 · 대상 · 끝 · 횟수 후보 = **레지스트리 목록 안에서만** · 조건 = 검증기 통과분만) → ②질문(코드 질문표 · 추천 답 미리 선택 · 선택지 + 직접 입력 · [이대로 만들기] 상시 · 혜택은 미리 안 채움 · 답은 브라우저 임시 보관으로 새로고침 보존) → ③설계(AI 1회: 칸 초안) → 서버 draft 저장 + 지도 레인에 점선 카드 → ④이어붙이기 점검(서버 CT · 줄마다 1클릭 고치기).
  문장이 여러 여정을 말하면(예: "가입부터 재구매까지") 해석이 최대 4개 여정 계획을 내고 차례로 설계 · 저장한다(초안 묶음 = `draft_group_id`). 요금 = 기존 여정 AI 생성 요금 기준 재사용(설계 착수 때 코드 확인) · 20 이상이면 확인 창 · 금액 = 서버 견적.
- **켜기(2차)**: 하단 "켜기 전 점검 n/m" 바(사전검사는 여정마다 비동기 · 기존 마커) → [모두 켜기] → 요약 확인 창 1개(여정별 상한 · 예상 인원 · 첫 발송 시각 · 하루 운영 크레딧 · 예상 발송비 · 소급 금지) → 서버 `activateJourneysInOrder`(받는 여정 먼저) → 카드마다 결과. 겹침 쌍마다 해소 선택(한쪽 자동 종료 켜기 · 한쪽 멈춤 · 첫 구매 고객 빼기 · 알고 둘 다 보냄) 필수. **피로도는 해소 선택지가 아니다**(회사 전체 설정 · 칸 소실 방식). 자동 활성화 0 · 게이트 우회 0 · 옛 목록 켜기 창은 겹침을 읽기 전용 경고로만 표시(동작 무변경).

## 6) 상품 레인 (3차)

- 트리거 `purchase.product`(레지스트리 + DB CHECK 동시 · 원칙 8) · 필터 = `{ product_keys: [...], door }` · 상품은 **그 회사 현역 문에서 관측된 목록에서만** 고른다(자사몰 = cdp_events 주문 상품 · 매장 = `purchases.product_code`/`product_name` · 직접 입력 없음 · 잘린 품목 수 표시).
- 목표 = 같은 상품 재구매(`goal_kind='product'` · 구매 신호 CT의 참/거짓 모드 = 두 문 OR · 상품 키 = 현역 문).
- 사용 기간 = 관측 재구매 간격 중앙값 + 표본 수 제안 → 담당자 확정 → 대기 칸 `delay_hours`에만 저장(products 칸 신설 없음 · 정답표 없음).
- 진입 교체 CT: 같은 여정 active 실행이 있는 고객이 새로 사면 옛 실행을 goal_met으로 닫고 새로 넣는다(추출 안티조인 · enqueue NOT EXISTS · 쿨다운 세 곳이 같은 CT를 부름 · **새 여정 · 직접 켠 여정만** = Harold 승인 결정 3). 프리셋 = `allow_reentry=true` · 쿨다운 0 · `auto_reentry_enabled=false` 서버 고정.
- 간선: `purchase.first` → `purchase.product` · `cdp.purchase` → `purchase.product`(계약 · parity). 겹침: `purchase.product` ↔ `cdp.purchase` · `purchase.first` · `customer.dormant_return`.
- 잠금: 현역 문이 바뀌면 · 몰별 동의 강제 회사(여정 동의 경로 전까지).

## 7) 갈림 (4차 · 끝 칸)

- `step_type='end'`(DB CHECK 없음 — 0929 pg_constraint 실측 · DDL 0) · 발송 0 · 실행기는 다음 칸이 끝이면 즉시 completed + 기록(journey_step_logs) · 끝 칸 delay = 0 고정 · 앞으로만 점프 불변.
- 배타 두 갈래 = `[조건] → A1 → A2 → 끝 → B1 → B2`, 아니오 → B1. 합류는 칸 복제("같은 문안 복제" 표시). 합류 수요가 실측되면 `next_goto` 재론.
- 배포 순서: 0차에 모르는 칸 종류 fail-closed(다섯 경로) → 4차 실행기 · 그림 · 통계 · 사전검사가 `end`를 아는 배포 → 운영 한 주기 뒤 `JOURNEY_END_CHIP_ENABLED`로 쓰는 경로(스튜디오 · AI) 개방.
- 새 조건 어휘: 고객 정보(`customer_field`) · 이 여정에 들어온 뒤 구매했나(`purchase_since_entry`) · 이 칸 링크를 눌렀나(`step_link_clicked` · 통계와 같은 step_id 축). 옛 두 종류는 기존 행 동작 유지 · 목록에서 숨김.
- 잠금: 갈림 · 끝이 있는 여정은 진행 중(active · paused) 실행 0일 때만 칸 넣기 · 지우기 · 아니면 새 판. 끝 칸 지우기 · 옮기기 = 자동 종료 끄기와 같은 게이트.

## 8) 새 판 (5차)

- 켜진 여정 구조 변경 = [새 판으로 고치기] → 복제 초안(`lineage_id` = 원 여정 계보) → 켜면 같은 트랜잭션에서 옛 판 `entry_closed_at = NOW()`.
- 진입 워커 · 재진입 워커 · 날짜 예약 스케줄러가 `entry_closed_at IS NULL`만 받는다 · 재진입 안티조인은 계보 단위(옛 판 진행 중 고객이 새 판에 이중 진입 0).
- 지도는 판을 한 카드로 묶고 옛 판은 "진행 중 N명 마무리 중"으로 접는다.

## 9) 차수 · 관문 (각 차수 완료 = 실측 관문 통과)

| 차수 | 내용 | 관문 |
|---|---|---|
| 0 | 발송 쪽 결함: ①비프리셋 저장 트리거 · 조건 유실(화면이 보내고 서버가 계약 검증) ②모르는 조건 field · op 저장 · 활성화 거부 ③프리셋 · AI 초안 재진입 계약 고정 · 자동 재진입 꺼짐 ④첫 구매↔주문 완료 겹침 + 배타 선언 parity ⑤흐름도 skip · 통계 번호 · 퍼널 색 · 시간 표기 ⑥다음 수 카드가 원 여정 자동 종료를 읽음 ⑦죽은 컨트롤 · 내부 용어 · 빈 화면 예시 ⑧AI 트리거 = 레지스트리 · 지연 상한 단일 출처 · 수정기 분기 보존 · 칸 한도 CT(자르지 않고 거부) ⑨활성 여정 자동 종료 끄기 · 목표 변경 = 일시정지 뒤 ⑩모르는 칸 종류 fail-closed 다섯 경로 ⑪자동 종료 기본값 = 계약 파생(새 여정) ⑫포인트 여정 목표 = 포인트 사용(새 여정) | 이어달리기 실측 1건 |
| 0.5 | hoyun 실데이터 정적 시안 → 레인 구성 · 방향 · 선 모양 확정 | Harold 확인 |
| 1 | 읽기 전용 생애 지도 · 빈 곳 찾기(DDL 0) | 가입 여정 자동 종료 켬 + 2번째 칸 1시간 → 테스트 구매 → due 뒤 지도 숫자 = SQL goal_met |
| 2 | 지도 위 만들기 · 이어 주기 · 칸 서랍 편집 · 문장으로 만들기 + 이어붙이기 점검 · 모두 켜기 · `step_label` · `draft_group_id` | 도식 왼쪽 · 가운데 줄을 문장 1개 + 확인으로 끝까지 |
| 3 | 상품 레인 · 구매 신호 CT · 진입 교체 · CHECK 확장 | 샤워비누(1개월 · 2달)가 매장 문 · 자사몰 문 회사 각 1곳에서 끝까지 · 다른 상품 구매로는 안 끝남 |
| 4 | 갈림(끝 칸) · 새 조건 2종 · 칸 한도 = 문자 칸 기준 | "샀으면 감사 끝 / 안 샀으면 리마인드 2통" |
| 5 | 새 판 · `lineage_id` · `entry_closed_at` | 판을 바꿔도 진행 중 고객이 두 판을 동시에 받지 않음 |

모든 차수: 기존 활성 여정 발송 결과 배포 전후 동일 · 동작이 바뀌는 항목은 새 여정 · 직접 켠 여정만 · DDL = NULL 허용 가산 · 배포 뒤 실행 · 42703 폴백 · 새 컬럼 endpoint catch = 503 `DB_MIGRATION_PENDING`.

## 10) DB (0929 Harold 실측)

- `pg_constraint`: `journeys_trigger_event_registered`(16값) · `journey_steps_journey_id_step_order_key UNIQUE(journey_id, step_order)` 뿐. **`step_type` · `goal_kind` CHECK 없음**(`journey-builder.ts:1170` 주석 "SCHEMA의 CHECK"는 오류 → 정정).
- 기존 컬럼: `journey_executions.entry_event_properties jsonb NULL` · `current_step_order int NOT NULL DEFAULT 0` · `journey_steps.not_met_goto int NULL` · `wait_event_name` · `wait_timeout_hours` · `condition_jsonb` · `journeys.goal_exit_enabled bool NOT NULL DEFAULT false` · `goal_kind varchar NOT NULL DEFAULT 'purchase'` · `start_kind varchar NOT NULL DEFAULT 'event'`.
- `purchases`: `product_id uuid` · `product_code` · `product_name` · `quantity` · `purchase_date timestamp` · `created_at timestamp` · `source_row_key` · `products`: `product_code` · `product_name` · 분류 3단 · `price`.
- 새 DDL(전부 배포 뒤 · NULL 허용): 2차 `journey_steps.step_label varchar(40)` · `journeys.draft_group_id uuid` / 3차 CHECK 교체(`purchase.product` 추가 · NOT VALID → VALIDATE) / 5차 `journeys.lineage_id uuid` · `journeys.entry_closed_at timestamptz`.

## 11) Harold 승인 결정 (0929 "추천대로")

1. 새 여정의 자동 종료 기본값 = 트리거 계약에서 파생(기존 행 무변경).
2. 포인트 여정 목표 = 포인트 사용(새 여정만).
3. 진입 교체(재구매 새 주기) = 새 여정 · 직접 켠 여정만.

그 밖 회의 결론(묻지 않고 확정): 사건 없는 넘김은 V2에서 안 함("목표 없이 끝난 N명" + 이탈·복귀 레인으로 잡음) · 여정끼리 밀어내지 않는 결정 유지(겹침은 표시 + 해소) · 운영 크레딧 과금 단위 유지(켜기 전 표시) · 레인 구성 · 방향은 0.5차 시안에서 확정 · 첫 화면 전환은 1~2차 실측 뒤.

## 12) 회의에서 갈린 것과 판단

| 쟁점 | 판단 | 근거 |
|---|---|---|
| 갈림 저장: 끝 칸 vs `next_goto` | 끝 칸 | 두 번째 순서 축이 없어 재번호 위험이 늘지 않음 · CHECK 없음(실측) · 합류는 복제 |
| 판정 시점 보정: 쓰기 sweep vs 조회 때 계산 | 조회 때 계산 | 쓰기는 재진입 쿨다운 기준(completed_at)을 바꿔 기존 활성 여정 동작 변경(`journey-reentry-worker.ts:95-101`) |
| 여정 펼침: 가로 띠 vs 열 안 세로 | 세로 | 도식 모양 · 옆 열 불변 · 갈림 시 공용 D+N 축 불성립 |
| 선 범위: 목표가 덮는 전부 vs 계약 간선 | 계약 간선 | 구매 목표 하나가 구매형 여정 전부를 덮어 선 폭발 · 덮는 목록은 카드 서랍에 |
| 상품 레인 vs 갈림 순서 | 상품 먼저 | 도식에 있는 것 · 막힘 6 중 3이 상품 |

## 13) 구현 기록

### 13-0. 0차 (0929 · 코드 완료 · 미배포)

| # | 무엇 | 파일 |
|---|---|---|
| ① | 화면이 AI 트리거 · 대상 조건을 저장에 싣는다(프리셋 · 시작 방식 분기 뒤 세 번째 분기) · 생성기가 레지스트리 목록 밖 트리거를 거부 · 저장 템플릿 코드 = 트리거 파생(`storageTemplateCodeFor`) · 계획 모달 "누구에게"(`describeJourneyTarget`) | `JourneysPage.tsx` handleSaveDraft · `journey-ai-generator.ts` · `journey-ai-editor.ts` · `journey-step-format.ts` · `JourneyPlanModal.tsx` |
| ② | 대상 조건 검증 CT(`findCustomerConditionIssues` · 추출기와 같은 허용 목록 상수) · 저장 거부 · 활성화 거부("새로 만들어야") · AI 초안은 빼고 "반영 안 됨"(`partitionCustomerConditions`) · 추출기 런타임 건너뛰기는 **유지**(기존 활성 여정 보호) | `journey-target-extractor.ts` · `journey-builder.ts` |
| ③ | 사건마다 받는 트리거(주문 완료 · 휴면 복귀) = 재진입 켜짐 + 계약 최소 쿨다운(`contractReentryPolicy` · 생성기 · 수정기) | `journey-trigger-capability.ts` |
| ④ | 첫 구매 ↔ 주문 완료 겹침 · 첫 구매 ⊥ 휴면 복귀 배타 · 구매 스트림 쌍 선언 parity · 계약 `lane` · `label` · `desc` + 카탈로그 미러 parity | 계약 · `journey-trigger-catalog.ts` · parity 테스트 |
| ⑤ | 흐름 그림 "조건 미충족 (skip)" → 실제 동작(지정 칸 · 없으면 여정 끝) · 칸 번호 · 시간 · 흐름 색 한 벌(`journey-labels.ts`) · 통계 번호 +1 정정 | `JourneyFlowDiagram.tsx` · `JourneyStatsPage.tsx` · `JourneysPage.tsx` |
| ⑥ | 다음 수 카드가 원 여정의 저장된 자동 종료 값을 읽고, 꺼져 있으면 경고 | `JourneysPage.tsx` |
| ⑦ | 조건 종류 죽은 선택지 2개 제거(AI 가 낸 옛 조건은 비활성 표시) · 분기 안내 문구 정정 · 빈 화면 예시 → 문장 채운 채 모달 열기 · 내부 용어(Step funnel · journey_step_logs · Skip · Variant Bandit · opt-out) | `JourneysPage.tsx` · `JourneyStatsPage.tsx` |
| ⑧ | AI 트리거 표 = 레지스트리 파생(`formatTriggerMenuForAi` · 예약 제외) · 대기 상한 8760 단일 출처(생성기 · 수정기 720 절단 제거) · 수정기 갈림 도착 칸 · 사건 대기 보존 · 칸 수 초과 거부(자르지 않음) | `journey-step-limits.ts` · 생성기 · 수정기 · 빌더 |
| ⑨ | 운영 중 옵션 = 자동 종료 **켜기만**(끄기 · 목표 변경 = 409 `JOURNEY_GOAL_CHANGE_NEEDS_PAUSE`) · 화면도 같은 규칙 | `routes/ai.ts` PATCH options · `JourneyOptionsEditor.tsx` |
| ⑩ | 모르는 칸 종류 fail-closed — 쓰기 5곳(생성 · 칸 추가 · 칸 편집 · AI 자유 생성 · AI 수정기) 거부 + 실행기는 보내지 않고 그 실행만 끝냄(`unknown_step_type`) · 라우트 400(`JourneyInputError`) | 빌더 · 수정기 · `journey-executor.ts` · `routes/ai.ts` |
| ⑪ | 자동 종료 기본값 = 계약 파생(`defaultGoalExitFor`) · 서버는 값이 없으면 파생 · 화면은 담당자가 만졌거나 서버가 기본값을 준 패키지일 때만 싣는다 | 빌더 · 생성기 · 수정기 · `JourneysPage.tsx` |
| ⑫ | 새 포인트 여정 목표 = `points_used`(빌더 INSERT) · 실행기가 저장된 `points_used`를 읽음 · 옵션 검증기 · 편집기 선택지 | 빌더 · 실행기 · `journey-options-validator.ts` · `JourneyOptionsEditor.tsx` |
| 검증 1 | (회의론자 치명) 대화형 수정이 정보 알림 · 날짜축 · 1회 설정을 버려 상시 여정이 되던 것 → 시작 방식 패키지는 트리거 · 대상 · 날짜 설정을 받은 그대로 반환 · 칸 D-N 보존 · 모르는 트리거 폴백 = 거부 · [AI 다시 생성]은 원 빌더로 돌려보냄 | 수정기 · `JourneysPage.tsx` regenerateFromPackage |
| 검증 2-나 | 생성 경로 타이밍 필터도 옵션 PATCH 와 같은 정규화(`normalizeJourneyOptions`) | 빌더 |

- 검증: 백엔드 tsc 0 · 프론트 tsc 0 · vitest 506 파일 / 6,946 · 새 테스트 `__tests__/journey-v2-phase0-0929.test.ts` 22건 · **회귀 주입 4건**(칸 종류 · 대상 조건 · 자동 종료 · 목표 종류를 옛 코드로 되돌리면 4건 실패 → 원복 뒤 통과).
- **배포 전 확인 SQL(관문 · 회의론자 검증 3 · 12)**: ①active · paused 여정의 `step_type` 분포에 message · wait · condition 밖 값 0 ②active · paused 여정 스냅샷(트리거 · 필터 · 자동 종료 · 목표 · 재진입 · 칸 수 · 칸 종류 · 지연)을 배포 전후로 떠서 차이 0 ③draft · paused 중 대상 조건 검증에 걸리는 행 목록(Harold 보고 · 자동 변경 없음) ④배포 뒤 비프리셋 AI 여정 1건 저장 → 계획 모달 "누구에게" = 저장된 trigger_filters.
- 활성 1행("회원가입 감사 안내" · 상시 · `{}`)은 자동으로 바꾸지 않는다(유료 사용 고객사 0 · Harold 0929). 0차 결함의 실제 사례로 기록.
- `auto_reentry_enabled` 생성 INSERT 미포함 = DB 기본값에 기댄다(기본값 미검증 → 배포 전 확인 SQL에 `column_default` 포함).

### 13-1. 회의론자 설계서 검증(0929)에서 뒤 차수로 넘긴 것 — 착수 때 이 목록부터

- **2차 켜기 묶음(치명)**: 라우트에만 있는 게이트(최초 활성화 200크레딧 확인 · 차감 · 매장번호 미등록 회신 확인 · 1회 발송 첫 적재)를 `activateJourneyGuarded` CT 로 옮겨 단건 라우트와 묶음이 같이 쓴다 · 시작 전 N×200 잔액 확인 · 요약 창에 활성화 요금 줄 · 중간 실패는 켜진 것 유지 + 카드별 결과.
- **2차 겹침 해소 두 종류**: 같은 사건 겹침(첫 구매↔주문 완료 · 주문 완료↔휴면 복귀) = 한쪽 멈춤 · 첫 구매 고객 빼기 · 알고 둘 다 보냄 / 진행 중 겹침 = 자동 종료 켜기. "첫 구매 빼기" = 새 필터 키 + 워커 자격 필터 CT 확장(키 없는 기존 행 동작 무변경).
- **2차 이어붙이기 1클릭 범위**: 초안 · 멈춤 = 전부 · 켜진 여정 = 자동 종료 켜기만(확인 창 "진행 중 N명에게도 바로 적용") · 나머지 = [일시정지하고 고치기] · 다시 켜기는 켜기 바에서.
- **1차 빈 곳 찾기**: 모달 AI 0 · [바로 만들기] = 프리셋 생성 재사용 + 크레딧 표시 · [질문 받고 만들기] = 2차 · 빈칸 판정 = 레인 키(정보 알림 제외).
- **2차 서버 초안 저장**: 기본 회신번호 없으면 그때만 묻기 · `collectStepIssues`를 백엔드 CT 로 · `draft_group_id`는 INSERT 뒤 별도 UPDATE(42703 삼킴) · 규약 밖 AI 결과는 같은 과금 묶음 안 1회 재요청 · 그래도 실패면 차감 없음.
- **포인트 목표**: 저장값 우선 · 파생은 빈 값일 때만(0차 반영) · 레인 숫자 라벨 "포인트가 줄어든 고객"(소멸도 포함) · 재진입 워커 INSERT 에 `points_at_entry` 싣기(3차 진입 교체 때 함께).
- **가입 여정 자동 종료 켜짐 부작용**: 목표 판정이 1번 칸 앞에서 돌아 가입 직후 산 고객은 환영 문자를 받지 않는다(첫 구매 여정이 받음) → 지도 카드 안내 문구.
- **자동 종료 기본값이 옛값에서 뒤집히는 트리거(새 여정만)**: 켜짐→꺼짐 = 휴면 복귀(옛 프리셋 'repeat') · 배송(옛 'cart') / 꺼짐→켜짐 = 가입 · 휴면(프리셋) · 구매 주기 이탈 · 포인트 · 조회 후 미구매(프리셋).

### 13-2. 1차 (0929~0930 · 코드 완료 · 미배포 · DDL 0)

| 무엇 | 파일 |
|---|---|
| 그래프 CT(칸 행 → 노드 · 간선 · 출구 · D+N · `current_step_order` 해석) · 순수 | `utils/journey-graph.ts` |
| 생애 지도 단일 조회(레인 · 카드 · 선 상태 7종 · 선 숫자 · 칸별 대기/출구 · 겹침 · 잠금 · 유령 카드 · 연동 필요 트리거 · 목표 이름 · 카드 안내) · 읽기 판정은 집합 SQL + 회사당 5분 캐시(쓰기 0) | `utils/journey-lifecycle-map.ts` · `GET /api/ai/operator/journeys/lifecycle-map` |
| 진입 표식 `entry_event_properties.__entry = { src:'trigger', key: 사건 id }`(선 숫자 "이어받음"의 재료 · 표식 이전 행 = "측정 전") | `journey-cdp-cursor.ts` · `journey-trigger-watcher.ts` |
| 기회 엔진 판정 축 = 마케팅 여정의 trigger_event(옛 template_code 오차단 · 정보 알림 계산 제외) · 카드마다 권하는 트리거 · 겹침 문장 = 계약 파생 | `journey-opportunities.ts` |
| 여정 지도 화면(캔버스 뷰 · 레인 열 + SVG 선 · 1024 이하 가로 스크롤 · 768 미만 레인 접기 + 카드 속 "다음 →" 줄 · 60초 갱신 · `?focus=`) · 빈 곳 찾기 창(4묶음 · AI 0 · 차감 0) · 칸 창(읽기 전용) | `pages/JourneyMapPage.tsx` · `components/journey/map/*` · `utils/journey-map.ts` · `styles/journey-map.css` |
| 목록 머리 [지도로 보기] · `?preset=시작 사건&objective=` = 기존 1클릭 생성 재사용 | `JourneysPage.tsx` · `App.tsx` |

- 검증: 백엔드 · 프론트 tsc 0 · `journey-v2-phase1-0929.test.ts` 22건 · 모양 실측(esbuild 번들 + Tailwind 빌드 CSS + puppeteer · 390 · 1024 · 1440): 가로 넘침 0 · 11px 미만 글자 0 · 콘솔 오류 0 · 1440 선 4개 모두 레인 사이 · 1차 측정에서 나온 결함 2(레인 사이가 좁아 이름표가 카드를 덮음 · 맨 오른쪽 레인 같은 레인 선이 화면 밖) 수정 뒤 재측정.
- **정정(0930)**: AI 여정 초안 생성(`journeys-ai-generate`)은 호출마다 3크레딧 차감이다(`services/ai.ts:106` source 맵 자동 차감 · `ai-credit-calc.ts` 'journey-ai-generate'). 처음에 "차감 없음"으로 적은 것은 라우트만 보고 쓴 오류. 지도 응답에 `costs`(단가표 값)를 싣고 빈 곳 찾기에 "초안 만들기 N 크레딧"을 표시한다.

### 13-3. 2차 (0930 · 코드 완료 · 미배포 · DDL 0)

| 무엇 | 파일 |
|---|---|
| 켜기 게이트 CT(검증 마커 · 매장번호 확인 · 최초 활성화 잔액 확인 → 켜기 → 차감 멱등키 `journey-activate:${id}` · 1회 발송 적재) — 단건 라우트 본문을 그대로 옮기고 응답 매핑 동일 · 묶음 = 받는 여정 먼저 · 시작 전 (초안 수 × 단가) 확인 · 카드별 결과 | `journey-activation.ts` · `POST /operator/journeys/:id/activate`(CT 호출) · `POST /operator/journeys-activate-batch` |
| 문장으로 만들기: 해석 AI 1회(묶음 · 차감 0 · 레지스트리 목록 안) → 코드 질문표(추천 답 미리 선택 · 혜택 비움 · 잠긴 사건 사유) → 여정마다 설계 요청 1회(묶음 안 1회 재요청 · 초안 저장 뒤 단가 1회 차감 · 멱등키 `journey-interview:${id}:${plan}` · 같은 요청 재전송 = 같은 초안) | `journey-interview.ts`(순수) · `journey-interview-ai.ts` · `journey-draft-save.ts` · `POST /operator/journeys-interview/parse` · `/design` |
| 서버 초안 저장(화면 handleSaveDraft 매핑 이전 · 사진 없는 사진 문자 → 장문) · 회신번호 목록 SQL 한 곳 | `journey-draft-save.ts` |
| 이어붙이기 점검 · 선마다 1클릭 고치기(서버가 정한 행동: 자동 종료 켜기 · 다시 받기 켜기 · 일시정지하고 켜기 · 받는 여정 켜기 · 만들기) | `journey-lifecycle-map.ts` `buildAttachCheck` · `fixForLine` · `GET /operator/journeys-attach-check` |
| 화면: 문장으로 만들기 창(새로고침 보존) · 켜기 전 점검 창(여정마다 사전 검증 · 최대 인원 · 처음 켜기 요금 · 겹침 고르기 · 카드별 결과) · 선 · 빈 곳 찾기 고치기 버튼 · 칸 창 [문안 고치기](기존 문안 수정 창) · 초안 막대 | `components/journey/map/InterviewModal.tsx` · `BatchActivateModal.tsx` · `JourneyMapPage.tsx` |

- **설계와 다르게 한 것**: `step_label` · `draft_group_id` DDL 은 하지 않았다. 묶음은 문장으로 만들기가 돌려준 id 목록을 켜기 창에 넘겨 해결했고(새로고침 뒤엔 초안 전부를 기본 선택), 칸 이름은 이름을 넣을 자리 · AI 출력 규약이 먼저 있어야 해서 뒤로 미룸. 요금 판단: 문장 해석은 차감 0 · 설계만 기존 단가(여정당 3).
- 검증: tsc 0 · `journey-v2-phase2-activation-0930.test.ts` 11건 · `journey-v2-phase2-interview-0930.test.ts` 13건 · 모양 실측(390 · 1440: 넘침 0 · 오류 0).

### 13-4. 3차 (0930 · 코드 완료 · 미배포 · DDL 1 = 시작 사건 CHECK 교체)

| 무엇 | 파일 |
|---|---|
| 계약 `purchase.product`(상품 고르기 전용 · AI 선택 · 1클릭 · 다음 수에서 뺌 · 목표 `product_repurchase` → goal_kind `product` · 사건마다 다시 받음) · 간선 첫 구매 · 주문 완료 → 상품 구매 · 겹침 3쌍 · 회사 데이터 판정 `hasProductPurchases` | `journey-trigger-capability.ts` · `company-data-profile.ts` · 화면 카탈로그(PICKER_TRIGGERS) |
| 상품 CT: 키 규칙 한 벌(자사몰 productId → productName · 원장 product_code → product_name) · 현역 문 관측 목록(180일 · 300개) · 사용 기간 제안(재구매 간격 중앙값 · 표본 5 미만이면 권하지 않음) · 배치 자격 필터 · 목표 SQL | `journey-product.ts` |
| 워커: 상품 자격 필터(구매 전이 자격 자리 · 커서 규약 불변) · 상품 없음 · 문 바뀜 = 사유 남기고 멈춤 · 진입 교체(`trigger_filters.entry_replace === true` 만 · 같은 트랜잭션에서 옛 실행 goal_met → 새 진입) · 겹침 해소 `exclude_first_purchase`(주문 완료 여정이 이전 구매 있는 고객만) | `journey-trigger-watcher.ts` · `journey-entry-replace.ts` |
| 실행기: 저장된 `product` 목표 = 진입 뒤 고른 상품 재구매(두 문 OR) · 상품 모르면 계속 | `journey-executor.ts` |
| 저장: 상품 · 문 없으면 거부 · 재진입 켜짐 · 쿨다운 0 · 진입 교체 켜짐 서버 고정 · 생성기 상품 경로 = 첫 문자 대기 = 확정 사용 기간 | `journey-builder.ts` · `journey-ai-generator.ts` |
| 만들기: 관측 목록 밖 상품 거부 · 몰별 수신동의 강제 회사 잠금 · DB CHECK 가 받기 전이면 AI 부르기 전에 503 · AI 1회 + 초안 + 1회 차감(멱등키 `journey-product:${id}`) | `journey-product-create.ts` · `GET /operator/journeys-product/catalog` · `POST /period` · `POST /create` |
| 화면: 상품 고르기 창 · 지도 유령 카드/선 고치기/빈 곳 찾기가 서버가 정한 만드는 길(`createMode`)로 · 옵션 창 "다시 사면 처음부터" 토글 · 상품 목표 이름 · 켜기 창 "첫 구매 고객 빼기" | `ProductJourneyModal.tsx` · `JourneyOptionsEditor.tsx` · `BatchActivateModal.tsx` |

- 검증: tsc 0 · `journey-v2-phase3-product-0930.test.ts` 23건 · 카탈로그 parity 14건 · 회귀 주입 1건(저장 경로 상품 블록 제거 → 2건 실패 → 원복).
- **목표 신호 CT(`journey-goal-signal.ts`) 이전은 하지 않았다** — 실행기 목표 판정에 상품 분기만 더했다(발송 경로 리팩터 위험 대비 이득 없음 · 구조 정리 과제로 남김).
- 범위 밖 발견: 여정 발송 전반이 몰별 수신동의(mall-consent CT)를 따르지 않는다(journey-* 사용 0). 상품 여정만 잠갔다.

### 13-5. 4차 (0930 · 코드 완료 · 미배포 · DDL 0)

| 무엇 | 파일 |
|---|---|
| 끝 칸 `step_type='end'`: 읽는 쪽(실행기 · 그림 · 활성화 · 통계 라벨)은 이번 배포부터 안다 · **쓰는 쪽(저장 · 칸 추가 · AI)은 `JOURNEY_END_CHIP_ENABLED=true` 일 때만**(운영 한 주기 뒤 켠다) · 첫 칸 끝 거부 · 끝 칸 대기 0 고정 | `journey-step-limits.ts` · `journey-builder.ts` |
| 실행기: 끝 칸 도착 = 발송 0 · completed(+ `end_step` 기록) · 다음 칸이 끝이면 기다리지 않고 완료 · 새 조건 2종(들어온 뒤 구매했나 = 목표 판정과 같은 함수 `hasPurchasedSinceEntry` · 앞쪽 문자 칸 링크를 눌렀나 = 통계와 같은 `message_click.properties.step_id` 축) · DB 오류 = 보류(error) | `journey-executor.ts` |
| 그림 CT: 끝 칸은 나가는 간선 없음 · 갈래별 D+N(앞 간선 누적 최소/최대) · 닿지 않는 칸 · 첫 칸 끝 = `blockingIssues` → 활성화 거부 · 목표 출구는 끝 칸 앞뒤 없음 | `journey-graph.ts` · `activateJourney` |
| 칸 한도 = 문자 7 + 전체 12(0차의 "모든 칸 7"에서 전환) · 저장 · AI 생성 · AI 수정 · 칸 추가 공통 | `journey-step-limits.ts` 외 |
| 갈림 잠금: 조건 · 끝 칸 여정은 진행 중(active · paused) 고객이 있으면 칸 넣기 · 지우기 거부(`BRANCH_LOCKED` · 새 판으로) · 링크 조건이 가리키는 칸은 지우기 거부 | `journey-builder.ts` add/delete |
| 링크 조건은 검토 화면에서 칸 번호로 고르고 저장 뒤 칸 id 로 바꿔 넣는다 | `createJourneyFromTemplate` |
| 화면: 칸 종류 "끝"(스위치 켜졌을 때) · 조건 2종 편집 · 흐름 그림 · 지도 칩 | `JourneysPage.tsx` · `JourneyFlowDiagram.tsx` · 지도 |

- 검증: `journey-v2-phase4-branch-0930.test.ts` 13건.

### 13-6. 5차 (0930 · 코드 완료 · 미배포 · DDL 2컬럼)

| 무엇 | 파일 |
|---|---|
| 새 판: 켜짐 · 멈춤 여정 → 복제 초안(상태 · 통계 · 커서 · 승인 · 기준선 비움 · 계보 = 원 여정) · 같은 계보 초안이 있으면 그것 · 링크 조건 칸 id 재연결 · A/B 변형은 옮기지 않음(개수 안내) | `journey-lineage.ts` `createNewVersion` · `POST /operator/journeys/:id/new-version` |
| 새 판을 켜면 **같은 트랜잭션**에서 같은 계보 옛 판(켜짐 · 멈춤) `entry_closed_at = NOW()` · DDL 전 = 옛 단일 문장 그대로 | `activateJourney` |
| 진입 워커 · 재진입 워커 · 날짜 예약 = 진입 열린 여정만 · 옛 판은 진행 중 고객이 다 끝나면 ended | `journey-trigger-watcher.ts` · `journey-reentry-worker.ts` · `journey-anchor-scheduler.ts` |
| 재진입 판정 계보 단위(재진입 불가 = 계보 어느 판이든 한 번 · 가능 = 다른 판 진행 중이면 그 판에서 마무리 · 쿨다운 = 계보 최근 진입) · 상시 여정 중복 제거도 계보 · 진입 교체는 계보 전체 진행 중 실행을 닫고 새 주기 | 워커 `checkCooldown` · `enqueueCandidates` · 추출 `buildReentryAntiJoin` · `custom` |
| 지도: 진입 닫힌 옛 판은 현재 판 카드에 접힘("옛 판 N개 · 진행 중 M명 마무리 중") · [새 판으로 고치기] | `journey-lifecycle-map.ts` · 지도 화면 |

- 검증: `journey-v2-phase5-lineage-0930.test.ts` 10건 · 백엔드 전체 512파일 / 7,040건 통과(0930).

### 13-7. 3차 보강(0930 · 5차 작업 중 발견)

- **활성화 커서 심기 목록에 `purchase.product` 누락** → 매장 원장 문은 커서가 없으면 열리지 않아 매장 회사 상품 재구매가 조용히 0건이 될 자리였다. 두 목록(`last_event_cursor` · `last_purchase_cursor`)에 추가.
- 겹침 해소 "주문 완료 여정에서 첫 구매 고객 빼기"(`exclude_first_purchase` · 워커 자격 필터 · 켜기 창 버튼 · 지도 겹침에서 제외) = §13-1 2차 이월분.

### 13-8. 배포 뒤 DDL (전부 배포 뒤 · 넣기 전엔 옛 동작 그대로 · 넣은 뒤 자동으로 열린다)

1. **3차** `journeys_trigger_event_registered` CHECK 교체 — 17값(`purchase.product` 추가) · `NOT VALID` → `VALIDATE` → 옛 제약 삭제 → 이름 변경 · 전 = 상품 여정 만들기 503(AI 호출 전 차단).
2. **5차** `journeys.lineage_id uuid NULL` · `journeys.entry_closed_at timestamptz NULL` · 전 = 새 판 버튼 없음 · 워커 옛 문장.

### 13-9. Codex 적대 리뷰 (0930 · 발송 · 과금 · DB 경로만 · 닫힐 때까지)

**1라운드 = needs-attention(높음 5 · 중간 4) → 9건 수용 · 1건 일부 불수용.**

| 지적 | 처방 | 자리 |
|---|---|---|
| 높음: 차감 실패를 성공으로 확정 · 회사 없는 멱등키 · 중간: 메모리 만료 뒤 중복 초안 | 뿌리 하나(요청 식별이 프로세스 메모리에만)로 보고 초안 저장 CT 한 곳에서 닫음. 과금 키에 회사 id · AI 전에 원장으로 이미 과금된 요청 거절 · 저장 뒤 확정(잔액 부족 = 방금 초안 지우고 402 · 같은 키 선점 = 지우고 거절 · 그 밖 실패 = 결과 유지 · 차감액 0) | `journey-draft-save.ts` `assertDraftRequestUnclaimed` · `settleDraftCharge` |
| 높음: 교체 뒤 쿨다운 거절 = 옛 실행만 닫힘 | 교체는 재진입 허용 + 시간 쿨다운 경과일 때만 닫고 바로 넣는다 | 워커 `finishCursorBatch` · `cooldownElapsed` |
| 높음: 닫힌 옛 판 재개가 현재 판 진입까지 닫음 | 닫기 문장 = 켜는 판 자신의 진입이 열려 있을 때만 · 옛 판에서 새 판 만들기 거절 | `journey-lineage.ts` |
| 높음: 스키마 확인 중 계보 보호 해제 | 진행 중 조회 공유 · 부재는 조회 성공 때만 기억 · 조회 오류는 던짐 | `lineageColumnsReady` |
| 중간: 소비 안 된 행(1,001번째)으로 상품 진입 | 자격 판정은 플래너가 소비한 앞 1,000행만(첫 구매 · 휴면 복귀도 같은 뿌리라 함께) | `qualifyPurchaseTransition` |
| 중간: 새 판으로 옮기면 자동 재진입 끊김 | 재진입 워커 이력 · 진행 중 · 최신 판정 = 계보 전체 · 넣는 곳 = 지금 판 | `journey-reentry-worker.ts` |
| 중간: 끝 칸 직전 동시 정지에서 발송비 누락 | 발송비는 상태와 무관하게 한 번 반영 · 완료 전환만 진행 중일 때 | `completeAtEndStep` |

- **불수용(별도 과제)**: 활성화 CT의 차감 반환값 무시 — 라우트의 기존 활성화 과금 문장을 그대로 옮긴 것(옛 동작 불변이 이번 범위). 잔액 부족 동시 소진 시 켜진 여정이 무과금으로 남을 수 있는 것은 **기존부터** 같다.
- 검증: `journey-v2-codex-r1-0930.test.ts` 15건 · 백엔드 전체 513파일 / 7,056건.

**2라운드 = needs-attention(높음 2 · 중간 2) → 높음 2 수용 · 중간 2 기록.**

| 지적 | 처방 | 자리 |
|---|---|---|
| 높음: 활성화가 계보 확인 오류를 다시 삼킴(`.catch(() => false)`) | 확인 오류 = 활성화 중단(잠시 후 다시 켜기) · 부재를 정상 조회로 확인했을 때만 옛 단일 문장 | `activateJourney` |
| 높음: 진입 교체와 자동 재진입 사이 공통 잠금 없음(같은 고객 진행 중 둘) | 진입 잠금 CT 신설(트랜잭션 advisory 잠금 · 열쇠 = 계보 뿌리 `COALESCE(lineage_id, id)`) · 고객을 넣는 세 트랜잭션(커서 문 · 일괄 문 · 재진입 워커)이 BEGIN 바로 뒤 먼저 잡는다 · 재진입 워커는 넣기와 합계를 한 트랜잭션으로 | `journey-lineage.ts` `lockLineageEntry` · 워커 두 곳 |

- **중간(기록만 · 돈 0)**: ①크레딧제 미적용 회사의 0원 성공은 원장 행이 없어 재시작 뒤 같은 요청이 초안을 한 번 더 만들 수 있다(요청 원장 테이블이 필요 · DDL 과제). ②끝 칸 완료의 실행 갱신과 여정 합계 갱신 사이 부분 실패 시 여정 합계(표시용 통계)만 빠질 수 있다 — 기존 `advanceOrComplete` 완료 경로와 같은 두 문장 구조.
- 검증: `journey-v2-codex-r1-0930.test.ts` 18건 · 백엔드 전체 513파일 / 7,059건.

**3라운드 = needs-attention(높음 1) → 수용 + 같은 자리에서 찾은 결함 1 함께.**

| 지적 | 처방 | 자리 |
|---|---|---|
| 높음: 잠금 뒤에도 미리 읽은 계보 · 진입 상태를 씀(그사이 새 판이 켜지면 두 판에 같은 고객 진행 중) | 진입 잠금이 잠금 **뒤** 같은 연결로 진입 닫힘 · 계보를 다시 읽어 돌려준다 · 세 트랜잭션은 닫혔으면 롤백(커서 그대로) · 판정은 다시 읽은 계보 · 새 판 활성화도 UPDATE 앞에서 같은 잠금 | `lockLineageEntry` · 워커 두 곳 · `activateJourney` |
| (내 검토) 새 판 전환 틈: 옛 판은 닫히는 순간 워커가 안 읽고 새 판 커서는 활성화 시각에서 시작 → 그 사이 사건이 어느 판에도 안 들어감(매장 원장 문은 최대 하루치) | 새 판이 **처음** 켜질 때 같은 계보의 켜진 옛 판(같은 시작 사건)의 커서 네 칸을 닫기 전에 이어받는다 · 멈춘 옛 판은 이어받지 않음(밀린 사건 소급 방지) | `INHERIT_ENTRY_CURSORS_SQL` |

- 남은 틈(기록): 가입 · 등급 변동처럼 커서가 아닌 기준선(진입 원장 · 등급 상태)으로 도는 시작 사건은 새 판 기준선을 켜는 순간 전 고객으로 심는다 → 옛 판 마지막 회차(5분 주기) 뒤 ~ 새 판 켜기 사이 가입 고객은 어느 판에도 안 들어갈 수 있다(최대 5분 · 기준선 CT 수정 과제).
- 범위 밖(Codex 3R 기록): `journey-lineage.ts` `createNewVersion` 이 연결을 돌려주기 전에 변형 수를 세는 별도 조회를 기다린다 — 동시 새 판 생성이 풀 크기만큼 몰리면 연결 대기.
- 검증: `journey-v2-codex-r1-0930.test.ts` 20건 · 백엔드 전체 513파일 / 7,061건.

**4라운드 = needs-attention(높음 1) → 수용.** 켜진 옛 판이 둘 이상(비정상)이면 커서 이어받기 원본이 비결정적이라 누락 · 재처리가 생길 수 있다 → 이어받기를 CTE 로 바꿔 원본이 **정확히 하나**일 때만 옮기고 원본 수를 돌려준다 · 활성화는 원본이 둘 이상이면 옛 판을 닫지 않고 트랜잭션 전체를 되돌린 뒤 "옛 판 하나를 멈춘 뒤 다시 켜 주세요"(`INHERIT_ENTRY_CURSORS_SQL` · `activateJourney`). 백엔드 전체 513파일 / 7,061건.

**5라운드 = approve(No material findings)** — 4라운드 수정 구간만 본 좁은 범위라 전체 통과로 치지 않는다 → 6라운드 = 1~4라운드 수정 전체 누적 재검토.

**6라운드(누적 재검토) = needs-attention(높음 1) → 구조로 수용.** 저장 뒤 차감 구조라 거절 때 초안을 지워야 했고, 지우기 실패 · 정산 중 활성화 경합이면 무과금 초안이 남았다 → 순서를 **AI 결과 → 차감 확정 → 초안 저장**으로 바꿨다(무과금 초안 0 · 삭제 장치 제거). 저장 실패 = 같은 시도 키로 환불. 요청 식별 = 원장의 시도 키 `요청 키#n`(되돌리지 않은 차감 = 이미 만든 요청 → 거절 · 환불된 시도만 = 다음 번호). 받아들이는 한계: 차감 확정 뒤 저장 전 프로세스가 죽으면 차감만 남는다(응답 직전 끊긴 다른 AI 기능과 같은 부류) (`journey-draft-save.ts` `nextDraftChargeKey` · `chargeThenSaveDraft`). 백엔드 전체 513파일 / 7,063건.

**7라운드 = 높음 0(중간 1) → 종료.** 중간: 환불까지 실패하면 차감이 남는데 두 라우트 500 문구가 "차감은 되지 않았어요"로 단정 → 단정 문구 제거(`routes/ai.ts` interview design · product create). 백엔드 513파일 / 7,063건 · 프론트 tsc 0.

- **Codex 종료 = 7라운드(높음 합계 12건 전부 닫음).** 남은 기록: 중간 2(크레딧제 미적용 회사 0원 성공의 요청 중복 · 끝 칸 합계 부분 실패) · 불수용 1(활성화 CT 과금 반환값 = 기존 문장 이동) · 가입 · 등급 기준선 전환 틈(최대 5분) · createNewVersion 연결 반환 전 별도 조회.
- **범위 밖(Codex 7R · 공용 과금 CT · 별도 과제)**: ①`ai-credit-tx.ts` 156행 — 미적용 판정이 중복 확인보다 먼저라, 같은 키 선행 차감이 마지막 구매분을 소진하면 후행 호출이 not_applicable 로 빠질 수 있다 ②`ai-credit-tx.ts` 383행 — 후불 base 100 · purchased 0 에서 150 차감 뒤 전액 환불하면 원 버킷이 복원되지 않을 수 있다.
