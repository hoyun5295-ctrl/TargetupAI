# 한줄로 — RISK REGISTER
> 이 문서가 리스크 목록의 유일한 소유 문서다. STATUS.md에는 활성 상위 5건 1줄 요약만 존재한다.
> 원본: STATUS.md §11 — 2026-07-03 관제탑 재설계 v2로 원문 그대로 이관.

## 11) RISK REGISTER (리스크 목록)
| ID | 리스크 | 확률(1-5) | 영향(1-5) | 점수 | 대응 |
|----|--------|-----------|-----------|------|------|
| R1 | TypeScript 타입 에러 배포 → 서버 크래시 | 2 | 5 | 10 | 배포 전 tsc --noEmit 필수 체크 |
| R2 | DB 파괴적 작업 시 데이터 유실 | 2 | 5 | 10 | pg_dump 백업 후 작업, 트랜잭션 활용 |
| R3 | QTmsg sendreq_time UTC/KST 혼동 | 1 | 4 | 4 | ✅ 해결: database.ts 풀 레벨 KST 보장 |
| R4 | 라인그룹 미설정 고객사 → 전체 라인 폴백 오발송 | 1 | 5 | 5 | ✅ 해결: 이중 방어 적용 |
| R5 | QTmsg LIVE→LOG 이동 후 결과 조회 불가 | 1 | 4 | 4 | ✅ 해결: LIVE+LOG 통합 조회 |
| R6 | 스팸필터 동시 테스트 시 결과 충돌 | 1 | 4 | 4 | ✅ 해결: SHA-256 세션 격리 + 디바이스 fallback |
| R15 | 발송 5개 경로 치환 로직 분산 → 재발 | 1 | 5 | 5 | ✅ 해결: messageUtils.ts 통합 |
| R16 | results.ts 대량 캠페인 OOM | 1 | 4 | 4 | ✅ 해결: UNION ALL 서버측 페이지네이션 |
| R17 | 선불 차감 후 발송 실패 → 정산 이슈 | 1 | 5 | 5 | ✅ 해결: 3경로 prepaidRefund + D57 C1 선별적 환불(부분실패 정확 환불) |
| R21 | standard_fields ↔ 코드 하드코딩 불일치 | 1 | 5 | 5 | ✅ 해결: D39 3세션 완료 — FIELD_MAP 단일 기준 |
| R22 | MySQL 외부 노출 → 랜섬웨어/데이터 삭제 | 1 | 5 | 5 | ✅ 해결: D49 — 127.0.0.1 바인딩+smsuser DROP 제거+비밀번호 강화+fail2ban+UFW |
| R23 | Docker 컨테이너 재생성 시 포트 바인딩 0.0.0.0 실수 | 2 | 5 | 10 | ⚠️ 운영: 컨테이너 작업 시 반드시 `docker ps --format` 포트 확인. OPS.md에 안전 명령어 기록 |
| R24 | SQL Injection → 내부 DB 공격 (127.0.0.1 우회) | 1 | 5 | 5 | ✅ 해결: D56 테이블명 화이트리스트 + D57-C4 sendTime 파라미터화 + **D59 custom_fields JSONB 키 화이트리스트(safe-field-name.ts 신규, campaigns/customers/ai 3파일 적용) + dateFilter MySQL 파라미터화 + mms-images UUID 검증 + upload.ts path.basename 경로탐색 방어** |
| R29 | 스팸필터 테스트 선불 차감 누락 → 무과금 발송 | 1 | 3 | 3 | ✅ 해결: D56 — spam-filter.ts에 prepaidDeduct 적용, 테스트폰×메시지타입 건수 차감 |
| R26 | JWT_SECRET/MYSQL_PASSWORD 환경변수 누락 → 서버 기동 실패 | 1 | 5 | 5 | ✅ 해결: D55 — fail-fast 적용, 폴백값 완전 제거. dotenv.config() app.ts 최상단 이동으로 로딩 순서 보장 |
| R27 | 슈퍼관리자 세션 무제한 → 토큰 탈취 시 24시간 악용 | 1 | 5 | 5 | ✅ 해결: D55 — 세션 레코드 생성+30분 타임아웃+서버측 세션 체크 적용 |
| R28 | Math.random() 임시비밀번호 → 예측 가능 | 1 | 3 | 3 | ✅ 해결: D55 — crypto.randomInt() CSPRNG 교체 |
| R25 | 백업 부재 → 랜섬웨어 시 복구 불가 | 1 | 3 | 3 | ✅ 해결: 2026-03-05 — pg_dump+mysqldump 자동화, 59번 서버(58.227.193.59) SCP 전송, SSH 키 인증, crontab 매일 03:00, 7일 보관 |
| R30 | 전화번호 정규화 불일치 → 개인화 메시지 치환 실패 | 1 | 4 | 4 | ✅ 해결: D57 C2 — normalizePhone() 단일함수 통일, directCustomerMap 키 불일치 수정 |
| R31 | 분할발송 시간 오버플로우 → 심야/새벽 발송 | 1 | 4 | 4 | ✅ 해결: D57 C3 — calcSplitSendTime() SEND_HOURS 경계 체크, 환경변수 기반 |
| R32 | AI발송 sendTime SQL Injection | 1 | 5 | 5 | ✅ 해결: D57 C4 — 템플릿 리터럴 삽입 제거, ? 파라미터화 |
| R33 | 테스트발송 bill_id 빈문자열 → 결과 추적 불가 | 1 | 3 | 3 | ✅ 해결: D57 C5 — randomUUID() 고유 추적ID 생성 |
| R34 | Redis 연결 에러 → 서버 크래시 | 1 | 5 | 5 | ✅ 해결: D59 — redis.on('error') 에러 핸들러 추가 |
| R35 | unhandledRejection/uncaughtException → 로깅 없이 서버 크래시 | 1 | 5 | 5 | ✅ 해결: D59 — process.on 핸들러 추가, PM2 자동 재시작 연계 |
| R36 | PostgreSQL Pool 커넥션 부족/누수 | 1 | 4 | 4 | ✅ 해결: D59 — max/idleTimeout/connectionTimeout 환경변수 기반 설정 |
| R37 | 수신거부번호 미로딩 상태 발송 → 법적 문제 | 1 | 5 | 5 | ✅ 해결: D59 — optOutNumber 초기값 '' + 3개 발송함수 가드 |
| R38 | 발송 상태 플래그 교차 미체크 → 동시 발송 | 1 | 3 | 3 | ✅ 해결: D59 — isSending/directSending 교차체크 3곳 |

---

