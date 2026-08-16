# 마케팅 진단 v3 — 진단다운 진단·스며드는 홍보 (설계·구현 기록)

> 2026-08-16 Harold 지시 "제대로 소집해서 진행" → 5역할 브레인스토밍(기획·프론트·백엔드·디자이너·회의론자,
> 1차 의견 → 교차 반박 → 회의론자 최종 검증 24건) 수렴안의 구현 설계서.
> 상설 소유 = [FEATURE-MARKETING-DIAGNOSIS.md](FEATURE-MARKETING-DIAGNOSIS.md) — 이 문서는 v3 시점 근거·seed 원문·검증 시나리오를 소유한다.
> 문구 원장(관찰·칭찬·아쉬움·처방·각주 전문)의 소유 = `packages/backend/src/utils/marketing-diagnosis-copy.ts` (여기 복사하지 않는다).

## §1 무엇이 왜 바뀌나 (회의 수렴 요지)

**진단명**: 현행 v2는 답변 조합 163,840가지에 리포트 본문이 약 20종 — 8문항 중 5문항은 어떤 답을 골라도
리포트가 한 글자도 안 바뀐다(리포트가 answers를 읽는 곳이 업종 추출 한 줄뿐). 소견 1번이 판매 문구 하드코딩.
= "마케팅 진단"이 아니라 "요금제 산정서"(Harold 지적 그대로).

**수렴 원칙 5**
1. **문진 = 분기형** — 축마다 전원 공통 게이트 1문항 + 그 답이 같은 섹션 안에서만 여는 심화 0~2문항.
   심화는 등급에 개입하지 않고(가산·캡 전부 금지) 처방·관찰 문장만 고른다. 잘하는 쪽에서만 깊어진다.
2. **판정 = 관문 사다리** — 총점·백분율 없음. 단계는 선행 축이 결정(명단 0이면 무조건 "모으기 전").
   축 등급 = 게이트 선택지의 `level`(seed 명시·오름차순 강제) 하나뿐.
3. **리포트 = 스토리 8블록** — 표지(강점절+약점절 2행+단계 눈금) → 들은 것 → 잘하는 것 → 축별 판정 →
   병목(인과 3단: 들은 것→생기는 일→바꾸는 방법) → 30일 실행 → 구분선+견적 → 업종 예시.
4. **홍보 = 위치 계약** — 표지~병목 자사 언급 0. 처방 각주(작은 활자·이탤릭·브랜드색 0) 최대 2회 + 견적 1회.
   판정 = 삭제 테스트(자사 문장 전부 지워도 문서 성립).
5. **원장 선행** — 자기 문장을 못 만드는 문항은 seed에 넣지 않는다(쌍둥이 테스트: 답 1개 차이 = 문장 최소 1개 차이).

**회의가 죽인 것**: MBTI 조합 라벨 / 총점 21점 / 점수 캡·가산 / 캔바·포토샵 상표 분기(→ "채널마다 다시
맞추나요" 관측 문항화) / 접힘 홍보 / 흐림·자물쇠 미리보기 / 의향 문항 4종(mobile_dm·auto_campaign·cdp·email_mkt).

## §2 definition 스키마 확장 (seed 소유 — 코드 배포 없이 문항·분기 변경)

```
{ version, rule_version,
  meta: { est_label: "약 3분 · 답변에 따라 문항이 달라져요",
          sections: [{ key, label, intro }] },        // 순서 = 문진 마디 순서 (진행 도트 = 이 개수 고정)
  questions: [{
    key, text, type: 'industry_grid'|'single',
    section: <meta.sections의 key>,                    // 전 문항 의무(meta.sections 있을 때)
    axis?: 'list'|'targeting'|'sending'|'production'|'repeat'|'measure',  // 있으면 = 축 게이트
    show_when?: { q: <앞 문항 key>, in: [option key…] },                  // 있으면 = 분기 심화
    tags?, options: [{ key, label, hint?, level?, unknown?, requires? }]
  }] }
```

**로더 검증(validateDefinition) 추가 규칙 — 어기면 활성화 자체가 503(fail-closed)**
- `show_when.q`는 **앞서 정의된·같은 섹션의·자신도 show_when이 없는** 문항만(깊이 2 상한·도트 고정·순환 불가).
- `show_when.in`은 그 문항의 실존 option key 부분집합·비어 있지 않음.
- `axis` 문항: show_when 금지(전원 노출) · 축당 정확히 1개 · options 4~5개 · `level`은 0~3 오름차순(미지정 = index).
- `requires` 붙은 문항: show_when 금지(분기 뒤 requires는 안 물은 경로에서 조용히 소실 — 회의 확정).
- v1·v2 형태(meta·section 없음)는 그대로 통과(하위 호환 — 기존 활성 seed 무영향).

**answers 검증(validateAnswers) — 가시성 기반으로 개편**
- 가시 집합 = show_when 없는 문항 + 조건 충족 분기(앞 문항 답 기준 단일 패스).
- 가시 문항 전부 답 필수 / **비가시 문항의 답이 오면 400**(프론트 prune 의무 — 서버는 게이트).
- `optionalKeys`(서버 실측 선치환 축): 답이 없으면 서버가 실측으로 채우고, 답이 오면 답을 쓴다
  (실측은 단조 증가라 로드 시점 선치환 ⇒ 제출 시점에도 선치환 가능 — 창 어긋남 없음).

## §3 문항 트리 v3 (요약표 — 원문은 §7 seed SQL)

| 섹션 | 문항(축) | 게이트 | 분기(show_when) |
|---|---|---|---|
| s1 기본 | industry(8칩+그 외) · touchpoint(접점→어절 슬롯) · owner | 판정 0 | owner=대행 → agency_scope |
| s2 고객 명단 | **list**: 연락처가 어디에(없음0/엑셀 산재1/포스·몰에 갇힘1/한곳3) | 축 게이트 | 한곳 → list_fields(명단에 뭐가 더) / 없음·산재·갇힘 → inflow_capture(광고 유입 연락처 남나 — 유입 축·유실 신호 흡수. list_inflow 문항은 leak 보기만 자기 문장을 가져 쌍둥이 테스트로 폐기·상한 20 준수) |
| s3 보내는 방식 | **targeting**: 가장 최근 발송 대상(안 보냄0/전체0/성별나이1/행동2/관심사3) · **sending**: 지난달 횟수(0/1~2/3~5/6+ — A는 실측 선치환) · **repeat**: 반복 메시지(없음0/수동1/예약2/자동3) | 축 게이트 3 | 전체 → optout_check(수신거부 확인했나) / 관심사 → segment_reuse(조건 관리) / 0회 → no_send_reason(이유 4갈래) / 3회+ → manual_ratio / 수동·예약 → manual_count(★유일한 시간 앵커) / 자동 → auto_count |
| s4 제작·성과 | **production**: 누가 만드나(안 만듦0/직접2/외부2/사내3) · **measure**: 결과 어디까지(안 봄0/건수1/클릭2/구매3) | 축 게이트 2 | 직접 → prod_time·prod_refit(채널 재작업 — 관측 문항화) / 외부 → prod_leadtime / 안 만듦 → copy_how / 안 봄·건수 → measure_reason(이유 4갈래 — "필요 없어서"는 처방 없음) / 구매 → measure_compare |
| s5 규모 확인 | scale_customers(max_customers requires) · scale_send · scale_ai(ai_credits requires — 상한 라벨 명기) | 견적 전용·판정 0 | 없음. 인트로 = "진단 문항은 여기까지예요. 요금 견적을 위한 마지막 3개만 확인할게요"(종료 선언 금지 — 회의론자 C5) |

풀 26문항 · 경로 체감 13~20 · 도트 5개 고정. 문형 규칙: 최근 사실만 / 정도 부사 0 / 능력 평가어 0 /
자기비하 보기에 안심 hint("이 단계에서 시작하는 곳이 많아요") / hint는 리포트에 절대 인용되지 않음(라벨만 인용).

## §4 판정 룰 (marketing-diagnosis-copy.ts + report CT)

- 축 등급 = 게이트 답 `level`(0~3). 심화는 불개입.
- 단계 관문(위에서 첫 일치): list=0 → 모으기 전 / targeting≤1 → 모으는 중 / repeat≤1 또는 measure≤1 →
  나누는 중 / 그 외 → 굴러가는 중. production·sending은 단계 불개입(칭찬·아쉬움 전용 — 회의 확정).
- `unknown:true` 답 3개 이상 = 단계 눈금 미발행("확인이 더 필요해요") — 병목·처방은 unknown 축 제외하고 발행(M4).
- 병목 = level≤1 축을 (level ASC, 우선순위 list>targeting>measure>repeat>production>sending)로 최대 3.
  병목 0 = 고도화 경로(심화 답 기반 제안 — segment_reuse=fresh·measure_compare=none 등).
- 모순 조합 관찰문 2종만 전용 집필: ①targeting=3 × list_fields=연락처뿐(기준이 머릿속에만)
  ②inflow_capture=안 남음 × list≤1(광고비로 부른 고객이 1회로 끝남). 강등 아님 — 소견 승격(회의 확정).
- 추천 = 기존 2축(max_customers·ai_credits) 그대로. **no_match 두 갈래**: 최고가 후보 행조차 요구 미달 =
  `over_range`("규모가 요금제 범위를 넘습니다" 고도화 상담) / 그 외 = 기존 상담 문구. CTA는 항상 있다.
- 효과 수치 = 계산 가능한 것만: A 실측 usage + manual_count 연환산(답변 하한 × 12 — "적어도" 서술). % 0.

## §5 result 스냅샷 v2 — V1 상위집합(하위 호환이 구조)

`DiagnosisResultV2` = **V1 전 필드 유지**(summary·findings·effects·recommendation·no_match·grant_outcome·examples)
+ 신규(stage·cover·observation·praises·axes·gaps·plan30·no_match_kind). `v: 2`.
- summary = 표지 문장(요금제 이름 금지). findings = 단계·병목 요약 파생(관리 화면 호환 — 무수정).
- 렌더 라우팅: 프론트 `DiagnosisReportView`가 `v===2 && stage!==undefined` → V2 뷰 / 아니면 **V1 뷰(현행 코드 동결
  이동 — ReportV1View.tsx)**. 기존 행 재열람 백지 위험(회의론자 C4) 폐쇄. 스냅샷 백필·마이그레이션 없음.
- 퍼널 B preview = 서버 허용 필드 조립(spread 금지): stage·cover·observation·praises·axes·**gaps 전체**(병목
  3건 인과 3단 포함 — 부분 공개 기각·흐림·자물쇠 기각). plan30·examples·recommendation·effects = 미포함(부재
  안내 평문 — "실행 순서는 담당자가 함께 정리해 드려요"). 수치 0(크레딧 역산 재발 금지).

## §6 회의론자 최종 검증 24건 처리

| # | 처리 |
|---|---|
| C1 분기 제출 400 | validateAnswers 가시성 개편(§2) — 로더·recommendPlan 같은 커밋 |
| C2 드래프트 고아 답 | 위저드 pruneAnswers(고정점) + 서버는 비가시 답 400 유지 |
| C3 B 표지 회사명 없음 | cover.subject = 접점·업종 구절(서버) · 회사명은 A(프롭)·B 폼 뒤 재렌더만 |
| C4 스냅샷 재열람 백지 | V1 뷰 동결 분리 + V2는 V1 상위집합(§5) |
| C5 종료 선언 이탈 | s5 인트로를 잔여 신호로("마지막 3개만") |
| C6 이탈 계측 공개 쓰기 | **이연** — DDL 필요라 이번 범위 밖. 잔여 과제로 보고(§9) |
| M1 prefill 둔갑 | 선치환 값은 answers 미저장 — result.observation에 실측 출처로만(§2 optionalKeys) |
| M2 월초 prefill 공백 | 판정 창 = 최근 30일 실적(월 경계 아님) |
| M3 questions 2경로 | 투영 함수 1개(projectQuestions)를 공개·인증 라우트가 공유 |
| M4 미발행인데 지급 | 미발행은 눈금만 — 병목·처방은 unknown 축 제외 발행 |
| M5 난이도 계수 | 곱셈 폐기 — owner 답은 처방 문구 선택 키로만 |
| M6 억지 강점절 | 강점 근거 0(전 축 ≤1)이면 표지 1행 + 접점 자산 문장으로 대체 |
| M7 집필 총량 | 원장 = 리포트 41 + 라벨 ~120 + hint ~20 — copy CT가 소유·개수 테스트 고정 |
| M8 no_match 갈래 정보 부재 | recommendPlan이 no_match_kind 계산해 반환 |
| M9 preview 역산 | 허용 필드 조립 유지 + 신규 필드 전부 수치 0 |
| M10 리밋 소진 | preview 리미터 분리(10분 10회) · submit 10분 5회 유지 |
| M11 관문 3연속 | **불수용** — 견적 3문항을 폼에 합치면 공용 위저드 1소스·preview 완전검증 계약이 깨진다. s5 인트로(C5)가 같은 위험 흡수. 근거 기록 |
| m1 경계 화면 진행 수단 | 인터스티셜은 [계속] 탭 전용(자동 넘김 금지) |
| m2 그 외 업종 목업 404 | industry='etc' → examples.industry=null(블록 생략) |
| m3 완주율 지표명 | "초대 표시 대비 완주"로 보고(§9 SQL) |
| m4 각주 상한 기계 검증 | copy CT 테스트 — 자사명 등장 위치·횟수 단정 |
| m5 카피 문항 수 노출 | est_label은 마디·시간만("약 3분") — 문항 수 표기 금지 |
| m6 판정 표 정렬 | 유지(회사별 강한 축 위) — 재열람은 스냅샷이라 안전 |
| m7 재실측 목록 | §8 검증 시나리오로 확정 |

## §7 seed v3 SQL (배포 후 Harold 실행 — v2 비활성 + v3 활성 한 트랜잭션)

```sql
BEGIN;
UPDATE diagnosis_question_sets SET is_active = false WHERE is_active;
INSERT INTO diagnosis_question_sets (version, definition, is_active) VALUES ('v3', $$
{"version":"v3","rule_version":"r3",
 "meta":{"est_label":"약 3분 · 답변에 따라 문항이 달라져요",
  "sections":[
   {"key":"s1","label":"기본 정보","intro":"먼저 어떤 곳인지 여쭤볼게요."},
   {"key":"s2","label":"고객 명단","intro":"고객 명단부터 여쭤볼게요."},
   {"key":"s3","label":"보내는 방식","intro":"이제 실제로 어떻게 보내고 계신지 여쭤볼게요."},
   {"key":"s4","label":"제작과 성과","intro":"만드는 과정과 결과 확인을 여쭤볼게요."},
   {"key":"s5","label":"규모 확인","intro":"진단 문항은 여기까지예요. 요금 견적을 위한 마지막 3개만 확인할게요."}]},
 "questions":[
 {"key":"industry","text":"어떤 분야이신가요?","type":"industry_grid","section":"s1","tags":["example_filter"],
  "options":[{"key":"fashion","label":"의류/패션"},{"key":"beauty","label":"뷰티/화장품"},
             {"key":"fnb","label":"식음료/카페"},{"key":"ecommerce","label":"쇼핑몰/이커머스"},
             {"key":"medical","label":"병원/의료"},{"key":"education","label":"학원/교육"},
             {"key":"travel","label":"여행/레저"},{"key":"fitness","label":"피트니스"},
             {"key":"etc","label":"그 외 분야"}]},
 {"key":"touchpoint","text":"고객을 주로 어디에서 만나시나요?","type":"single","section":"s1",
  "options":[{"key":"online","label":"온라인 몰에서만 만나요","hint":"쇼핑몰, 스마트스토어 등"},
             {"key":"offline","label":"매장이나 현장에서 만나요"},
             {"key":"both","label":"온라인과 매장 둘 다예요"},
             {"key":"booking","label":"예약이나 상담을 받아서 만나요","hint":"병원, 학원, 피트니스, 여행 등"}]},
 {"key":"owner","text":"마케팅은 지금 누가 하고 계신가요?","type":"single","section":"s1",
  "options":[{"key":"self","label":"대표가 직접 해요","hint":"가장 흔한 형태예요"},
             {"key":"staff","label":"직원이 다른 일과 함께 해요"},
             {"key":"dedicated","label":"전담 담당자가 있어요"},
             {"key":"agency","label":"외부 대행사에 맡겨요"}]},
 {"key":"agency_scope","text":"대행사는 어디까지 해주나요?","type":"single","section":"s1",
  "show_when":{"q":"owner","in":["agency"]},
  "options":[{"key":"make","label":"문구와 이미지 제작까지요"},
             {"key":"send","label":"발송까지 대신해요"},
             {"key":"report","label":"성과 보고까지 해줘요"},
             {"key":"unsure","label":"계약 범위를 정확히는 몰라요","unknown":true,"hint":"흔한 일이에요"}]},

 {"key":"list","text":"고객 연락처는 지금 어디에 있나요?","type":"single","section":"s2","axis":"list",
  "options":[{"key":"none","label":"따로 모으고 있지 않아요","level":0,"hint":"이 단계에서 시작하는 곳이 많아요"},
             {"key":"scattered","label":"엑셀이나 장부 여기저기에 있어요","level":1},
             {"key":"locked","label":"포스기나 쇼핑몰 안에만 있어요","level":1,"hint":"그 밖으로 꺼내기 어려운 상태"},
             {"key":"unified","label":"한곳에 모아 관리하고 있어요","level":3}]},
 {"key":"list_fields","text":"그 명단에는 연락처 말고 무엇이 더 있나요?","type":"single","section":"s2",
  "show_when":{"q":"list","in":["unified"]},
  "options":[{"key":"contact_only","label":"연락처와 이름 정도예요"},
             {"key":"visits","label":"최근 방문이나 구매 날짜까지 있어요"},
             {"key":"purchase","label":"구매 금액과 횟수까지 있어요"},
             {"key":"interest","label":"산 상품이나 관심사까지 있어요"}]},
 {"key":"inflow_capture","text":"광고나 검색을 보고 온 고객의 연락처가 남나요?","type":"single","section":"s2",
  "show_when":{"q":"list","in":["none","scattered","locked"]},
  "options":[{"key":"no_capture","label":"남지 않아요"},
             {"key":"event_only","label":"이벤트 때만 남아요"},
             {"key":"mostly","label":"대부분 남아요"},
             {"key":"unknown","label":"확인해 본 적 없어요","unknown":true}]},

 {"key":"targeting","text":"가장 최근 발송은 누구에게 보내셨나요?","type":"single","section":"s3","axis":"targeting",
  "options":[{"key":"never","label":"아직 보낸 적이 없어요","level":0},
             {"key":"all","label":"명단 전체에게 보냈어요","level":0,"hint":"가장 흔한 방식이에요"},
             {"key":"demo","label":"성별이나 나이로 나눠 보냈어요","level":1},
             {"key":"behavior","label":"최근 방문이나 구매 여부로 골랐어요","level":2},
             {"key":"interest","label":"산 상품이나 관심사까지 보고 골랐어요","level":3}]},
 {"key":"optout_check","text":"그 발송 뒤에 수신거부를 확인해 보셨나요?","type":"single","section":"s3",
  "show_when":{"q":"targeting","in":["all"]},
  "options":[{"key":"not_checked","label":"확인해 보지 않았어요","hint":"대부분 그래요"},
             {"key":"few","label":"몇 명 있었어요"},
             {"key":"many","label":"평소보다 많았어요"},
             {"key":"unknown_where","label":"어디에 쌓이는지 몰라요","unknown":true}]},
 {"key":"segment_reuse","text":"고르는 조건은 어떻게 관리하세요?","type":"single","section":"s3",
  "show_when":{"q":"targeting","in":["interest"]},
  "options":[{"key":"fresh","label":"매번 새로 만들어요"},
             {"key":"saved","label":"몇 개 저장해 두고 써요"},
             {"key":"auto","label":"조건이 자동으로 갱신돼요"}]},
 {"key":"sending","text":"지난 한 달 동안 고객에게 몇 번 보내셨나요?","type":"single","section":"s3","axis":"sending",
  "options":[{"key":"zero","label":"한 번도 안 보냈어요","level":0},
             {"key":"s1_2","label":"1번에서 2번이요","level":1},
             {"key":"s3_5","label":"3번에서 5번이요","level":2},
             {"key":"s6p","label":"6번 이상이요","level":3}]},
 {"key":"no_send_reason","text":"보내지 않은 이유에 가까운 것은요?","type":"single","section":"s3",
  "show_when":{"q":"sending","in":["zero"]},
  "options":[{"key":"no_list","label":"보낼 명단이 없어서요"},
             {"key":"no_copy","label":"무엇을 써야 할지 몰라서요"},
             {"key":"no_time","label":"시간이 나지 않아서요"},
             {"key":"no_effect","label":"효과가 없다고 느껴서요"}]},
 {"key":"manual_ratio","text":"그중 직접 명단을 골라 보낸 건 몇 번인가요?","type":"single","section":"s3",
  "show_when":{"q":"sending","in":["s3_5","s6p"]},
  "options":[{"key":"all_manual","label":"전부 직접 골랐어요"},
             {"key":"half","label":"절반쯤이요"},
             {"key":"few","label":"한두 번이요"},
             {"key":"mostly_auto","label":"대부분 예약이나 자동이에요"}]},
 {"key":"repeat","text":"생일 축하나 재방문 안내처럼 반복해서 나가는 메시지가 있나요?","type":"single","section":"s3","axis":"repeat",
  "options":[{"key":"none","label":"아직 없어요","level":0,"hint":"여기서 시작하는 곳이 많아요"},
             {"key":"manual","label":"생각날 때 직접 보내요","level":1},
             {"key":"scheduled","label":"날짜를 정해 예약 발송해요","level":2},
             {"key":"auto","label":"조건이 맞으면 자동으로 나가요","level":3}]},
 {"key":"manual_count","text":"지난 한 달에 손으로 챙긴 발송이 몇 번쯤인가요?","type":"single","section":"s3",
  "show_when":{"q":"repeat","in":["manual","scheduled"]},
  "options":[{"key":"c1_2","label":"1번에서 2번이요"},
             {"key":"c3_5","label":"3번에서 5번이요"},
             {"key":"c6_10","label":"6번에서 10번이요"},
             {"key":"c10p","label":"10번 넘게요"}]},
 {"key":"auto_count","text":"지금 몇 종류가 자동으로 돌고 있나요?","type":"single","section":"s3",
  "show_when":{"q":"repeat","in":["auto"]},
  "options":[{"key":"a1_2","label":"1개에서 2개요"},
             {"key":"a3_5","label":"3개에서 5개요"},
             {"key":"a6p","label":"6개 이상이요"},
             {"key":"a_unknown","label":"세어 보지 않았어요","unknown":true}]},

 {"key":"production","text":"고객에게 나가는 이미지나 안내 화면은 누가 만드나요?","type":"single","section":"s4","axis":"production",
  "options":[{"key":"none","label":"따로 만들지 않아요","level":0,"hint":"문자만 보내도 괜찮아요"},
             {"key":"self","label":"담당자가 직접 만들어요","level":2},
             {"key":"outsource","label":"외부에 맡겨요","level":2},
             {"key":"inhouse","label":"사내 디자이너가 만들어요","level":3}]},
 {"key":"prod_time","text":"한 건 만드는 데 보통 얼마나 걸리나요?","type":"single","section":"s4",
  "show_when":{"q":"production","in":["self"]},
  "options":[{"key":"fast","label":"30분 안쪽이요"},
             {"key":"halfday","label":"반나절쯤 걸려요"},
             {"key":"fullday","label":"하루 이상 걸려요"},
             {"key":"gaveup","label":"만들다 그만둔 적도 있어요","hint":"흔한 일이에요"}]},
 {"key":"prod_refit","text":"만든 이미지를 채널마다 다시 맞추는 일이 있나요?","type":"single","section":"s4",
  "show_when":{"q":"production","in":["self"]},
  "options":[{"key":"yes","label":"있어요, 채널마다 다시 만들어요"},
             {"key":"rare","label":"크기만 살짝 고치는 정도예요"},
             {"key":"no","label":"한 번 만들면 그대로 써요"}]},
 {"key":"prod_leadtime","text":"요청하고 받기까지 며칠 걸리나요?","type":"single","section":"s4",
  "show_when":{"q":"production","in":["outsource"]},
  "options":[{"key":"sameday","label":"당일에 받아요"},
             {"key":"d2_3","label":"2일에서 3일이요"},
             {"key":"week","label":"일주일 넘게 걸려요"},
             {"key":"varies","label":"그때그때 달라요"}]},
 {"key":"copy_how","text":"그럼 문구는 어떻게 준비하세요?","type":"single","section":"s4",
  "show_when":{"q":"production","in":["none"]},
  "options":[{"key":"reuse","label":"예전에 보낸 것을 고쳐 써요"},
             {"key":"new","label":"매번 새로 써요"},
             {"key":"given","label":"본사나 거래처가 준 것을 써요"},
             {"key":"no_copy","label":"문구 없이 보낼 때도 있어요"}]},
 {"key":"measure","text":"가장 최근 발송의 결과를 어디까지 보셨나요?","type":"single","section":"s4","axis":"measure",
  "options":[{"key":"none","label":"결과를 보지 않았어요","level":0,"hint":"확인 방법을 모르셔도 괜찮아요"},
             {"key":"counts","label":"보낸 건수와 실패 건수요","level":1},
             {"key":"clicks","label":"링크를 누른 사람까지요","level":2},
             {"key":"revenue","label":"실제 구매나 방문까지요","level":3}]},
 {"key":"measure_reason","text":"결과를 더 보지 않는 이유에 가까운 것은요?","type":"single","section":"s4",
  "show_when":{"q":"measure","in":["none","counts"]},
  "options":[{"key":"dont_know","label":"어디서 보는지 몰라서요"},
             {"key":"no_time","label":"볼 시간이 없어서요"},
             {"key":"what_next","label":"봐도 무엇을 바꿀지 몰라서요"},
             {"key":"no_need","label":"지금은 굳이 필요 없어서요"}]},
 {"key":"measure_compare","text":"지난달과 이번 달을 무엇으로 비교하세요?","type":"single","section":"s4",
  "show_when":{"q":"measure","in":["revenue"]},
  "options":[{"key":"none","label":"따로 비교하지 않아요"},
             {"key":"feel","label":"대략 느낌으로요"},
             {"key":"notes","label":"숫자를 적어 두고 봐요"},
             {"key":"report","label":"보고서로 정리해요"}]},

 {"key":"scale_customers","text":"관리할 고객 수는 어느 정도인가요?","type":"single","section":"s5","tags":["recommend"],
  "options":[{"key":"none","label":"아직 없어요"},
             {"key":"u100k","label":"10만 명 미만","requires":[{"column":"max_customers","op":"gte_or_null","value":100000}]},
             {"key":"k100_300k","label":"10만에서 30만 명","requires":[{"column":"max_customers","op":"gte_or_null","value":300000}]},
             {"key":"k300_1m","label":"30만에서 100만 명","requires":[{"column":"max_customers","op":"gte_or_null","value":1000000}]},
             {"key":"o1m","label":"100만 명 이상","requires":[{"column":"max_customers","op":"gte_or_null","value":3000000}]}]},
 {"key":"scale_send","text":"한 달 발송량은 어느 정도가 될까요?","type":"single","section":"s5",
  "options":[{"key":"u10k","label":"1만 건 미만"},{"key":"k10_100k","label":"1만에서 10만 건"},
             {"key":"k100_500k","label":"10만에서 50만 건"},{"key":"o500k","label":"50만 건 이상"}]},
 {"key":"scale_ai","text":"AI로 문구나 이미지를 만든다면 한 달에 몇 번쯤 쓰실까요?","type":"single","section":"s5","tags":["recommend"],
  "options":[{"key":"none","label":"안 쓸 것 같아요"},
             {"key":"u10","label":"월 10회 이하","requires":[{"column":"ai_credits_per_month","op":"gte","value":50}]},
             {"key":"m10_50","label":"월 10회에서 50회","requires":[{"column":"ai_credits_per_month","op":"gte","value":250}]},
             {"key":"o50","label":"월 50회에서 100회","requires":[{"column":"ai_credits_per_month","op":"gte","value":500}]}]}
]}
$$::jsonb, true);
COMMIT;
```

## §8 검증 시나리오 (v3)

| # | 시나리오 |
|---|---|
| V-1 | FREE 완주(분기 경로 2종: 전 축 하위 / 전 축 상위) → 제출 200 · TRIAL 지급 · grants 1행 |
| V-2 | v1·v2 스냅샷 행 `/report` 재열람 → 옛 레이아웃 정상(백지 0) |
| V-3 | 게이트 답 변경 후 재제출 payload에 고아 분기 답 0(프론트 prune) · 서버에 고아 답 강제 전송 → 400 |
| V-4 | 쌍둥이: targeting all↔behavior 두 제출의 result 문장 차이 ≥ 3곳(표지·병목·처방) |
| V-5 | B preview 응답에 recommendation·effects·plan30·examples 부재 + 수치(원·회·건) 0 |
| V-6 | 자사명 등장 = plan30 각주 ≤2 + 견적 1 — observation·praises·gaps·cover에 0(기계 테스트) |
| V-7 | unknown 3개 답변 → stage 미발행 + 병목은 unknown 축 제외 발행 |
| V-8 | A 실측 선치환: 지난 30일 발송 있는 FREE → sending 문항 미노출·제출 answers에 미포함·관찰에 실측 서술 |
| V-9 | scale_customers o1m + (요금제 전 행 미달 구성) → no_match_kind='over_range' 고도화 문구 |
| V-10 | 관리 목록·상세: v3 행 답변 라벨 정상(분기 문항 포함) · v2 행 무영향 |
| V-11 | 활성 seed에 show_when 순환·타 섹션 참조 주입 → 로더 503(fail-closed) |
| V-12 | 완주율 SQL(초대 표시 대비 완주): `SELECT (SELECT count(*) FROM marketing_diagnoses WHERE funnel='A')::float / NULLIF((SELECT count(*) FROM diagnosis_invites),0)` |

## §8-1 Codex 적대 리뷰 취사 (1R medium 5 + 2R medium 2 = 7 전부 수용 · critical·high 0 · 2R 종료)

| # | 지적 | 처리 |
|---|---|---|
| 1 | 실측 sending을 클라이언트가 덮어쓸 수 있고 비가시 분기 답이 처방 입력으로 샘 | **수용** — 실측이 있으면 서버값 무조건 강제 + 서버 게이트 기준 잔재 분기 답 서버 정리 + 저장 = 정리된 clientAnswers(실측 축 미포함 — M1 유지) |
| 2 | 문항을 본 버전과 계산 버전 미결속(v2→v3 전환 중 조용한 재해석) | **수용** — preview·submit에 `question_set_version` 결속. 불일치 = 409 `VERSION_CHANGED`(프론트 code 구분·드래프트는 버전 키라 자연 무효). 미전송 구클라이언트 = 기존 동작 |
| 3 | 표지 약점절이 level 무시(level 1 정상 답변에 level 0 문구) | **수용** — COVER_GAP을 축×level 원장으로. GAPS 전 조합 표지 절 실존 계약 테스트 |
| 4 | over_range가 최고가 1행·가격 단조 가정 | **수용** — 전 후보 기준 "수치 룰 전부 만족 후보 0"으로 재정의 |
| 5 | 손상 definition이 503이 아니라 TypeError 500 | **수용** — 참조 options `Array.isArray` 가드 + no-throw 계약 테스트 |
| 2R-1 | 일부 축만 있는 definition이 없는 축을 level 0으로 단정한 거짓 표지 | **수용** — 축 게이트 전부 아니면 0(validateDefinition 강제 + 테스트) · 단계 미발행 시 표지 폴백 중립화 |
| 2R-2 | 버전 불일치 409가 "커밋 후 응답 유실 + 버전 전환" 재시도의 복구 경로를 가림 | **수용** — 버전 불일치 시 기존 funnel A 행 우선 확인 → 있으면 저장 결과 반환(완료 사용자 초기화 금지) |

## §9 잔여 (이번 구현 범위 밖 — 착수는 Harold 판단)

1. **문항 단위 이탈 계측**(회의론자 C6) — 신규 테이블 DDL 필요. 리밋 공유 + body 화이트리스트 조건 명세는 회의록에.
2. ?src= 축으로 B preview 공개 범위 실험(계측 붙은 뒤에만 의미).
3. plans 한도 실값 역전 정정 시 auto_campaign·cdp 축 requires 재도입(코드 무변경 — seed v4).
