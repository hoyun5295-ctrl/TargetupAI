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

1. **AI 자동제작 T0** = 설계서 §9 착수 전 실측 3건(Harold SQL·API) → §12 T1~T8. 첫 코드는 `utils/ai-auto-build-materials.ts`(순수 · RED→GREEN).
2. 우커머스 회신이 오면: 설계서 §9 2차 목록의 "우커머스 어댑터"와 별개로, 답 7개를 실측 게이트(REST 401 · 웹훅 1건 · SDK 삽입 리허설)로 판정 → 어댑터 설계서.
3. 범위 밖 기록(착수 판단 = Harold): `expired-pending-sweeper`·`system-monitor-worker` bulk-only(STATUS ⑥-③) · 재대조 보류 백오프·경보 · 확정 불일치 21일 재선정 · 상세 3경로 합집합 스캔 · 백엔드 `/api/sales-outreach/badge` 소비처 0 · 메이크뷰식 PC 2쪽 펼침·썸네일.

## 4. ⛔ 절대 규칙(이번 세션에서 확정)

- 집계 합집합(`getCompanyAllLiveSmsTables`)에서 bito 라인을 다시 빼지 않는다. 라인 종류가 늘면 그 함수를 먼저 본다.
- 재대조 워커는 실측 0건에 적재 증거가 맞서면 덮지 않는다(시각만 기록). 0을 읽었다 ≠ 없다.
- AI 자동제작은 설계서 §2 불변 14개 밖으로 나가지 않는다. 특히 신규 크레딧 키·DDL·역할 지정 UI·이름 매칭 자동 첨부는 이번 트랙에 없다.
