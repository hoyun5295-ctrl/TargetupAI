# 0914 세션 인계: 발송결과 0 재대조(B-0914-1 종결) · 슈퍼관리자 뱃지(B-0914-2) · DM 슬라이드 뷰어(B-0914-3) · AI 자동제작 설계서 (2026-09-14 작성)

> 이 문서는 **Harold님이 실행할 순서와 명령**, 다음 세션이 이어받을 자리만 담는다. 사실·경위의 소유 문서는 아래 링크가 가진다.
> 착수 첫 명령은 **현재 상태 확인**이다(이 문서의 상태는 작성 시점 값). 명령마다 실행 위치를 적었다. 한 번에 하나씩 실행하고 결과를 본 뒤 다음으로 간다.

## 0. 먼저 읽을 것

1. 이 문서 전체
2. [BUGS.md](../status/BUGS.md) B-0914-1(종결 기록·복구 결과) · B-0914-2 · B-0914-3
3. AI 자동제작 착수 세션이면 [2026-09-14-ai-auto-build-design.md](2026-09-14-ai-auto-build-design.md) **§2 → §3 → §5 → §6 → §12** (회의 원문은 0914 세션 scratchpad `meeting/` · 소실돼도 설계서 §3·§10이 판정과 근거를 소유)

## 1. 이번 세션에서 한 것

| 축 | 무엇 | 상태 | 소유 문서 |
|---|---|---|---|
| B-0914-1 발송결과 0 | 집계 합집합에 bito 라인 합류 · 재대조 워커 0건 가드(보류 시각 기록) · SELECT 4곳 sentTables · 계약 테스트 | **배포완료 · PG 복구 20건 완료 · 접수 2건(금강제화·아이디룩) 닫힘 · 화면 육안 대기** | BUGS B-0914-1 |
| B-0914-2 슈퍼관리자 뱃지 | 발신프로필 승인대기 축(`pending-badges senderProfiles`) + 템플릿 관리 뱃지 + 승인·반려 즉시 갱신 · AI 영업 뱃지 제거 · SCHEMA 4컬럼 등재 | **코드완료 · push·배포 대기(프론트 빌드 필요)** | BUGS B-0914-2 |
| B-0914-3 DM 슬라이드 뷰어 | 이미지 무대(상하 중앙·크롭 0) · 점 스트립 가로 스크롤 · PC 같은 열 + 화살표·←/→ · 테스트 8 | **코드완료 · push·배포 대기(백엔드만)** | BUGS B-0914-3 |
| AI 자동제작 | 브레인스토밍(5역할 2라운드 + 회의론자 최종 8건) → 설계서 완성 · SOT-INDEX 등재 | **설계 완료 · 다음 세션 착수(§12 T0부터)** | 설계서 |
| 우커머스 연동 문의 | 박성용 경유 고객사 질문 7개 전달 | **회신 대기** | memory `project_2026_0914_line_reassignment_result_zero` |

검증(마지막 실행): backend tsc 0 · vitest 285파일 4,424건 · frontend tsc 0 · harness-check 통과 · Codex 적대 2R(B-0914-1 · high 0 종결) · B-0914-2·3은 UI·읽기 전용이라 Codex 대상 제외.

## 2. Harold님 실행 순서

### 2-1. 커밋·push (아직 안 했으면)
▶ 실행 위치: 로컬 PowerShell (`C:\Users\ceo\projects\targetup`)
```powershell
tp-push "0914 DM 슬라이드 뷰어 개선(B-0914-3) + 슈퍼관리자 뱃지(B-0914-2) + B-0914-1 종결 기록 + AI 자동제작 설계서·SOT 등재·0914 인계(tsc 0 · 테스트 4,424 · DDL 0)"
```

### 2-2. 배포 (OPS §2-2 · 백엔드 + 프론트 둘 다)
▶ 실행 위치: .62 · administrator
```bash
cd /home/administrator/targetup-app && git pull
```
```bash
cd /home/administrator/targetup-app/packages/backend && npm run build:safe
```
```bash
cd /home/administrator/targetup-app/packages/frontend && npm run build:safe
```
```bash
pm2 reload targetup-backend
```
배포 확인:
```bash
grep -c "senderProfiles" /home/administrator/targetup-app/packages/backend/dist/utils/pending-badges.js; grep -c "dm-page--stage" /home/administrator/targetup-app/packages/backend/dist/utils/dm/dm-viewer.js; pm2 status targetup-backend
```
둘 다 1 이상 + online이면 정상. 프론트는 Ctrl+F5.

### 2-3. 실측
- B-0914-2: 슈퍼관리자 로그인 → 발송 관리 메뉴에 빨간 점 + 템플릿 관리 항목에 승인대기 수(크로커다일 1건 이상) · 고객 관리 점 사라짐 · 승인 처리 직후 뱃지 감소.
- B-0914-3: 34장 DM(아이디룩 등 `layout_mode=slides`)을 모바일에서 열어 세로 사진 상하 중앙 · 점 스트립 스크롤 · 카운터 · PC에서 열 중앙 + 화살표·←/→ · 혼합 장(제목+버튼) 현행.
- B-0914-1: 채널통합조회 9/4 금강제화 33,346/28,423/4,923/0 · 상세 분포·발송내역 · 슈퍼관리자 목록 · 아이디룩 9/13 205건 완료. 하루 뒤 백업표 정리:
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "DROP TABLE IF EXISTS campaigns_b0914_backup;"
```

## 3. 다음 세션 착수 원장

0. ~~**★2026-09-14 2세션 진행분** = AI 자동제작 T0 → T1~T7 → T8 배포·ENV·실측.~~ (완료 · **§5 로 이동** · 실측 5건만 남음) 상태·명령·실측 시나리오의 소유 = [설계서 §13·§14](2026-09-14-ai-auto-build-design.md). 인계 원장은 이 항목 하나로 갈음한다(중복 기록 0).
1. ~~**AI 자동제작 T0** = 설계서 §9 착수 전 실측 3건(Harold SQL·API) → §12 T1~T8. 첫 코드는 `utils/ai-auto-build-materials.ts`(순수 · RED→GREEN).~~ (완료 · 0번 참조)
2. 우커머스 회신이 오면: 설계서 §9 2차 목록의 "우커머스 어댑터"와 별개로, 답 7개를 실측 게이트(REST 401 · 웹훅 1건 · SDK 삽입 리허설)로 판정 → 어댑터 설계서.
3. 범위 밖 기록(착수 판단 = Harold): `expired-pending-sweeper`·`system-monitor-worker` bulk-only(STATUS ⑥-③) · 재대조 보류 백오프·경보 · 확정 불일치 21일 재선정 · 상세 3경로 합집합 스캔 · 백엔드 `/api/sales-outreach/badge` 소비처 0 · 메이크뷰식 PC 2쪽 펼침·썸네일.

## 4. ⛔ 절대 규칙(이번 세션에서 확정)

- 집계 합집합(`getCompanyAllLiveSmsTables`)에서 bito 라인을 다시 빼지 않는다. 라인 종류가 늘면 그 함수를 먼저 본다.
- 재대조 워커는 실측 0건에 적재 증거가 맞서면 덮지 않는다(시각만 기록). 0을 읽었다 ≠ 없다.
- AI 자동제작은 설계서 §2 불변 14개 밖으로 나가지 않는다. 특히 신규 크레딧 키·DDL·역할 지정 UI·이름 매칭 자동 첨부는 이번 트랙에 없다.

---

## 5. ★ 2세션(0914 오후~저녁) 결과 · 다음 세션 착수 원장

| 축 | 결과 | 소유 문서 |
|---|---|---|
| AI 자동제작 | T1~T8 **배포완료**(restart 687 · ENV 디버깅테스트 1회사 · 카페24 `hanjulai` active) · Codex 적대 2R(돈 경로 · 정정 4) · **실측 5건 미실행** | **상설 [FEATURE-AI-AUTO-BUILD.md](FEATURE-AI-AUTO-BUILD.md) 신설**(§5 실측 · §6 이력 · §7 남은 것) · 시점 = [설계서](2026-09-14-ai-auto-build-design.md) §13·§14 |
| 우커머스 연동 | 고객사 회신 5/7 → 설계안 동의 → **W1~W7 배포**(restart 688) → 고객사 "플러그인 아니면 불가?" → **① wc-auth 관리자 승인 1클릭(키 자동 전달 · 웹훅 4개 REST 자동 생성 · 백필) + ② 플러그인 zip 배포**(restart 690 · plugin.zip 200) · 4몰 실측(회원가입 폼 수신동의 `mssms_agreement` 4몰 공통 · 앱 인증 302) · 고객사 회신 문안 작성 | [설계서](2026-09-14-woocommerce-integration-design.md)(§1 실측 · §2 불변 12 · §3 구조 · §5 W1~W10 · §6 미검증 · §7 후속) · [INTEGRATIONS.md 우커머스 절](../status/INTEGRATIONS.md) |
| B-0914-3 DM 슬라이드 뷰어 | 1차 배포 → 16:15 재오픈(툴바 `100vh` 잘림 · 카운터가 제품 코드 가림 · 점 "확대") → 정정 배포(restart 691 · 높이 기준 `innerHeight` → `--dm-vh` · 아래 띠 = 진행 막대·5px 점·카운터) + 펼친 갤러리 장 `visible` 누락(빈 장) 동봉 · 단축 URL 375×640 실측 통과 | [BUGS B-0914-3](../status/BUGS.md) |
| B-0914-2 슈퍼관리자 뱃지 | 배포완료(1차 배포에 동승) · 실측 대기 | [BUGS B-0914-2](../status/BUGS.md) |

검증(마지막 실행): backend 297파일 4,661건 · tsc 0 · frontend tsc 0 · build:safe 둘 다 · harness-check 통과 · DDL 0.

**다음 세션 착수 순서**
1. **우커머스 운영 첫 승인 1건**(고객사 회신 = 4몰 관리자 승인 담당자 · 주문 단계 수신동의 · 규모): 관리 → 자사몰 연동 → 우커머스 → 몰 주소 → "관리자 승인으로 연결" → 승인 뒤 서버 `pm2 logs targetup-backend --nostream | grep "WooCommerce auth-callback"`(키 수신 · 웹훅 +4 · 백필 건수) → 첫 웹훅 `grep "WooCommerce Webhook"` 로 헤더·본문 실측 → 설계서 §6 미검증을 한 줄씩 닫는다. 플러그인 zip 전달 → WooCommerce → 한줄로 화면 "연결됨 · 웹훅 4개" 확인.
2. **AI 자동제작 실측 5건**(FEATURE-AI-AUTO-BUILD §5 · 디버깅테스트 · 도달 불가 값) → 통과 시 ENV 확대 판단.
3. **B-0914-3 박성용 재확인 회신**(툴바 있는 폰 · 아래 띠 · 5장 제품 코드).
4. 범위 밖 기록(착수 판단 = Harold): FEATURE-AI-AUTO-BUILD §7 · 우커머스 설계서 §5-0 범위 밖 · 재대조 보류 백오프·경보·21일 재선정 · `expired-pending-sweeper`·`system-monitor` bulk-only · 메모리 인덱스 회전(28KB · 종결 트랙을 `archive/INDEX.md` 로).

**⛔ 이번 2세션에서 확정된 규칙**
- 우커머스 externalId·orderId 는 `{mall}:{id}` 접두(워드프레스 id 는 몰마다 겹친다) · 몰 식별자는 `normalizeWooMallId` 한 함수 · 앱 인증 state 는 서명·1회용·TTL 셋 다 · 콜백은 즉시 200 · 플러그인은 비밀 0.
- DM 슬라이드 뷰어 높이 기준은 `100vh` 가 아니라 보이는 높이(`--dm-vh`) · 이미지 위에 아무것도 얹지 않는다.
- AI 자동제작 돈 단위 = attemptToken + 과금 지문 · 판독비는 초안 뒤 정산(FEATURE §2-9·10).

---

## 6. ★ 3세션(0914 밤) 결과 · 다음 세션 착수 원장

박성용 접수 2건(`cmu0wlphl02fxjnlucoe2mbh1` · `cmu0zpd0z02gyjnluuclvxk9r`). 원인·수정·영향 확인·범위 밖 = [BUGS B-0914-4·5](../status/BUGS.md)가 소유.

| 축 | 결과 |
|---|---|
| B-0914-4 주소록 번호 앞 0 | 업로드 파서가 CSV 원문 `0100…`도 숫자로 읽어 0 소실(로컬 실측) · 주소록만 되살리는 곳이 없었다 → `routes/address-books.ts` 저장·추가(중복 판정)·조회·다운로드 4곳이 `normalizeAgencyPhone`(휴대폰 10자리만 복원) · 옛 저장분은 읽을 때 복원 · 파서·화면 무변경 · **배포완료** |
| B-0914-5 알림톡 예약·분할 | 알림톡 창에 입력 없음 + Dashboard가 알림톡이면 분할 `false`·예약은 직접발송 패널 전역값 + processor가 알림톡 행 시각 버림 + CT-04 `sendreq_time=NOW()` 고정 → 알림톡 창 로컬 상태(부달 아래 카드 2 · `ScheduleTimeModal` 재사용) → 확인 창 → Dashboard 알림톡 분기는 확인 창 값만 · processor `reservedDate` · CT-04 시각 있으면 `?` · `/:id/message` 알림톡 거부 + `msg_type NOT IN ('F','K')` · **배포완료** |
| 운영 실발생 1건 | PG `a8cf5f94-605f-4b6f-829a-1a26b3afe474`(예약 17:35 · 등록 17:29 · `sentTables=["SMSQ_SEND_14"]`) · MySQL seqno 47238 `K · sendreq_time 17:29:08 · mobsend_time 17:29:09 · 1800` = 예약이 즉시 발송 |

검증(마지막 실행): 새 테스트 4파일 16건(RED 확인 후 GREEN) · backend 301파일 4,677건 · tsc 0(양쪽) · build:safe 둘 다 · 산출물 확인(백엔드 dist 4파일 · 프론트 `alimtalkSplitEnabled`) · 서버 배포 확인(src grep 4·1·6·2 = 로컬 동일 · 프론트 `Dashboard-CB1fZZTv.js` · restart 692 online) · harness-check 통과 · DDL 0 · Codex 미실행(규칙상 대상 = 돈·국세청·DDL, 이번 변경은 해당 없음).

**다음 세션 착수 순서 (운영 검증 = Harold)**
1. 알림톡 20분 뒤 예약 1건(본인 번호) → 아래 PG 조회로 `status=scheduled`·예약 시각 확인 → MySQL로 K행 `sendreq_time`=예약 시각·`status_code=100` → 도래 후 수신.
2. 같은 조건 1건 예약 후 취소 → 같은 MySQL 조회 결과 0행.
3. 3건 분할 1건/분 → `sendreq_time` 1분 간격.
4. 1~3을 표준 QTmsg 라인 1회·비토 라인 1회(표준 라인의 예약 보류는 서버 에이전트 설정이라 이 실측이 유일한 증거).
5. 0 빠진 CSV로 주소록 등록 → 조회 번호 `010…` → 불러오기 발송 성공 1건.

▶ 실행 위치: .62 (한줄로 서버) · administrator 셸
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT id, status, scheduled_at, created_at, send_config->'sentTables' AS sent_tables, target_count FROM campaigns WHERE send_channel = 'alimtalk' AND send_config->>'scheduled' = 'true' ORDER BY created_at DESC LIMIT 3;"
```

▶ 실행 위치: .62 (한줄로 서버) · administrator 셸 (비밀번호 프롬프트 입력 · `<N>`·`<캠페인 id>`는 위 조회 결과)
```bash
docker exec -it targetup-mysql mysql -usmsuser -p smsdb -e "SELECT seqno, msg_type, sendreq_time, mobsend_time, status_code FROM SMSQ_SEND_<N> WHERE app_etc1 = '<캠페인 id>';"
```

**⛔ 이번 3세션에서 확정된 규칙**
- 알림톡 예약·분할 값은 `AlimtalkSendModal`이 소유한다. Dashboard 전역 `reserveEnabled`·`splitEnabled`를 알림톡 발송에 쓰지 않는다(계약 = `alimtalk-reserve-split-contract.test.ts`).
- 큐 적재 CT가 시각 필드를 받으면 SQL도 그 필드를 읽는다(`insertAlimtalkQueue`·`insertBrandQueue` 같은 형태 · `alimtalk-queue-reserved.test.ts`).
- 예약 문안 수정은 브랜드(F)·알림톡(K) 행을 덮지 않는다.
- 주소록 번호 복원 = `routes/address-books.ts` 한 파일. 업로드 파서(`upload.ts`)는 공용이라 손대지 않는다.

**범위 밖 기록(착수 판단 = Harold)**: 옛 `/direct-send` 알림톡 분기 시각 미적재(화면 도달 0) · 한줄전단 주소록(`/api/flyer/address-books`) 동일 결함 여부 · 예약 분할의 21시 이월 규칙(`calcSplitSendTime`)을 알림톡(정보성)에도 그대로 적용 중.
