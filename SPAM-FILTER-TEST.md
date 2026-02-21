# 스팸필터 테스트 시스템 레퍼런스

## 개요
- 고객사가 실제 발송할 메시지가 통신사 스팸필터에 걸리는지 사전 테스트하는 시스템
- 웹(한줄로) → 백엔드 → QTmsg Agent 10 → 이통사 → 테스트폰(스팸한줄 앱) → 서버 리포트 → 결과 판정
- 테스트 전용 라인 격리 (Agent 10 / SMSQ_SEND_10)

---

## 테스트 흐름

```
1. 사용자가 웹에서 스팸필터 테스트 요청
2. 백엔드 POST /api/spam-filter/test
   → PostgreSQL spam_filter_tests INSERT (status: active)
   → PostgreSQL spam_filter_test_results INSERT (통신사별 × 타입별)
   → MySQL SMSQ_SEND_10 INSERT (QTmsg 발송 큐)
3. QTmsg Agent 10이 SMSQ_SEND_10 폴링 → 중계서버 발송
4. 이통사 → 테스트폰 도달
5. 스팸한줄 앱이 SMS/LMS 수신 감지 → POST /api/spam-filter/report
6. 백엔드가 발신번호 기반으로 active 테스트 매칭 → 결과 업데이트
7. 백엔드 15초 폴링: QTmsg 성공(6/1000) + 앱 미수신 → 즉시 blocked 판정
   - 최종 3분 타임아웃: 남은 미판정 건 → timeout 처리
```

---

## QTmsg Agent 10 (테스트 전용)

| 항목 | 값 |
|------|-----|
| Deliver ID | targetai10_m |
| Report ID | targetai10_r |
| SMS 테이블 | SMSQ_SEND_10 |
| 로그 테이블 | SMSQ_SEND_10_YYYYMM |
| admin_port | 9010 |
| 경로 | /home/administrator/agent10/ |
| 중계서버 | 58.227.193.58:26352 |
| 용도 | **테스트 전용 (격리)** — 대량발송과 완전 분리 |

### Agent 10 관리
```bash
# 시작
cd /home/administrator/agent10/bin && ./qtmsg.sh start

# 중지
cd /home/administrator/agent10/bin && ./qtmsg.sh stop

# 로그 확인
tail -50 /home/administrator/agent10/logs/*mtdeliver.txt

# bind 상태 확인
grep "bind ack" /home/administrator/agent10/logs/*mtdeliver.txt | tail -5

# 에러 확인
grep -i "error\|fail\|reject\|잔액" /home/administrator/agent10/logs/*mtdeliver.txt | tail -20

# 프로세스 확인
ps aux | grep agent10 | grep -v grep
```

### Agent 10 주요 결과 코드
| 코드 | 코드명 | 의미 | 판정 |
|------|--------|------|------|
| 6 | E_SENT | SMS 전송 성공 | 성공 → 앱 수신 대기 |
| 1000 | E_OK | LMS/MMS 전송 성공 | 성공 → 앱 수신 대기 |
| 1800 | E_K_OK | 카카오톡 전달 성공 | 성공 |
| 100 | E_READY | 발송 대기 | 대기 중 |
| 104 | - | 중계서버 처리 대기 | 대기 중 (rsv1=3이면 중계서버에서 보류) |
| 7 | E_EXPIRED | 비가입자/결번/서비스정지 | 발송 실패 |
| 8 | E_POWEROFF | Power-off | 발송 실패 |
| 16 | E_SPAM | 이통사 스팸 차단 | **스팸 차단됨** |
| 52 | E_SPAM_WORD | 릴레이서버 스팸 단어 | **스팸 차단됨** |
| 53 | E_SPAM_TELNO | 스팸 번호 | **스팸 차단됨** |
| 54 | E_SPAM_WORD_TELNO | 스팸 단어 조합 | **스팸 차단됨** |
| 55 | E_BILL_LIMIT_OVER | **중계서버 잔액부족** | 발송 실패 → 충전 필요 |
| 9008 | E_REG_NO | 발신번호 미등록 | 발송 실패 |
| 9010 | E_CM_CALLBACK_SPAM | 콜백번호/수신번호 스팸처리 | **스팸 차단됨** |
| 500 | E_REJECT_SMS | SMS 스팸 판단 전송거절 | **스팸 차단됨** |
| 62 | E_SAME_DESTNO_CONTENTS | 동일 대상/내용 1초내 중복 | 발송 거절 |

### ⚠️ 트러블슈팅 교훈
- **status_code 55 (잔액부족)**: QTmsg 중계서버 선불 잔액 문제. INVITO 내부 충전 후 재시도
- **rsv1=3, mobsend_time=NULL**: 중계서버에 전송됐지만 이통사에 미전달. 결과코드 확인
- **rsv1=5**: Agent가 월별 로그 테이블로 이동 완료. SMSQ_SEND_10_YYYYMM에서 조회
- **sendreq_time**: 반드시 MySQL NOW() 사용. JS에서 KST 넣으면 미래시간 → Agent 예약 대기

---

## MySQL 테이블

### SMSQ_SEND_10 (발송 큐)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| seqno | int PK AUTO_INCREMENT | |
| dest_no | varchar(20) | 수신번호 (테스트폰) |
| call_back | varchar(20) | 발신번호 |
| msg_contents | mediumtext | 메시지 내용 (원본 그대로, 080 치환 없음) |
| msg_type | char(1) | S=SMS, L=LMS |
| sendreq_time | datetime | **반드시 NOW()** |
| status_code | int | 100=대기, 6=SMS성공, 1000=LMS성공 |
| rsv1 | varchar(1) | 1=대기, 2=처리중, 3=전송완료, 4=결과수신, 5=월별처리완료 |
| app_etc1 | varchar(50) | **spam_filter_tests.id 저장** (매칭용) |

### SMSQ_SEND_10_YYYYMM (결과 로그)
- Agent가 결과 수신 후 월별 테이블로 이동 (rsv1: 4→5)
- 타임아웃 판정 시 여기서 조회해야 함

---

## PostgreSQL 테이블

### spam_filter_tests (테스트 건)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | |
| user_id | uuid FK | |
| callback_number | varchar(20) | 발신번호 |
| message_content_sms | text | SMS 메시지 (원본) |
| message_content_lms | text | LMS 메시지 (원본) |
| spam_check_number | varchar(20) | 사용 안 함 (NULL) — 080 치환 제거됨 |
| status | varchar(20) | pending → active → completed |
| created_at | timestamptz | |
| completed_at | timestamptz | |

### spam_filter_test_results (통신사별 결과)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| test_id | uuid FK | |
| carrier | varchar(10) | SKT / KT / LGU |
| message_type | varchar(10) | SMS / LMS |
| phone | varchar(20) | 테스트폰 번호 |
| received | boolean | 앱 수신 여부 |
| received_at | timestamptz | |
| result | varchar(20) | received/blocked/failed/timeout |

### spam_filter_devices (테스트폰)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| device_id | varchar(100) | Android ANDROID_ID |
| carrier | varchar(10) | SKT / KT / LGU |
| phone | varchar(20) | 테스트폰 번호 |
| device_name | varchar(100) | |
| is_active | boolean | |
| last_seen_at | timestamptz | |

---

## 테스트폰 현황

| 통신사 | 번호 | 비고 |
|--------|------|------|
| KT | 01026268125 | 활성 |
| LGU | 01082336860 | 활성 |
| SKT | 01041906860 | 활성 |

---

## 백엔드 API (spam-filter.ts)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | /api/spam-filter/test | 스팸필터 테스트 요청 (authenticate) |
| POST | /api/spam-filter/report | 앱 수신 리포트 (X-Spam-Token 인증) |
| GET | /api/spam-filter/active-test | 진행 중 테스트 조회 |
| GET | /api/spam-filter/tests | 테스트 이력 목록 |
| GET | /api/spam-filter/tests/:id | 테스트 상세 결과 |
| POST | /api/spam-filter/devices | 디바이스 등록 (앱) |
| GET | /api/spam-filter/admin/devices | 슈퍼관리자 디바이스 목록 |

### 핵심 로직
- **테스트 생성**: spam_filter_tests INSERT → 통신사별 result 행 생성 → MySQL SMSQ_SEND_10 INSERT
- **리포트 매칭 (2026-02-20 개선)**: 
  - 발신번호로 active 테스트 후보 조회
  - 1건이면 바로 매칭 (대부분 이 케이스)
  - 복수 건(동시 테스트)이면 메시지 내용(공백/줄바꿈 제거 normalize)으로 확정
  - fallback: 내용 매칭 실패 시 가장 최근 건에 매칭
  - ⚠️ 다른 회사가 동일 발신번호로 동시 테스트해도 메시지 내용으로 정확히 분리
- **스팸 판정 (15초 폴링, 2026-02-20 개선)**:
  - 발송 후 15초마다 MySQL 결과 조회 (현재 큐 + 월별 로그 테이블 양쪽)
  - QTmsg 성공(6/1000/1800) + 앱 미수신 → **즉시 blocked (스팸 차단)** 판정
  - QTmsg 실패(7/8/55 등) → **즉시 failed (발송 실패)** 판정
  - QTmsg 대기(100/104) → 다음 폴링에서 재확인
  - 3분 초과 시 남은 미판정 건 → timeout 처리 후 테스트 완료
- **MySQL 조회 주의**: Agent가 이미 로그 테이블(SMSQ_SEND_10_YYYYMM)로 이동했을 수 있음 → 양쪽 모두 조회 필요
- **쿨다운**: 회사당 60초
- **동시 제한**: 회사당 active/pending 테스트 1건

### 앱 인증
- 토큰: `X-Spam-Token: spam-hanjul-secret-2026`
- 환경변수: `SPAM_APP_TOKEN`

### 리포트 매칭 코드 (spam-filter.ts POST /report)
```typescript
// 1) 발신번호로 active 테스트 후보 조회
const candidates = await query(
  `SELECT id, message_content_sms, message_content_lms FROM spam_filter_tests
   WHERE status = 'active'
     AND REPLACE(callback_number, '-', '') = $1
   ORDER BY created_at DESC`,
  [senderClean]
);

// 2) 단일 건 → 바로 매칭 / 복수 건 → 메시지 내용(normalize)으로 확정
if (candidates.rows.length === 1) {
  testId = candidates.rows[0].id;
} else {
  const normalize = (s: string) => (s || '').replace(/[\s\r\n]+/g, '');
  const matched = candidates.rows.find((row: any) =>
    normalize(row.message_content_sms) === msgNorm ||
    normalize(row.message_content_lms) === msgNorm
  );
  testId = matched ? matched.id : candidates.rows[0].id; // fallback: 최신 건
}
```

---

## 스팸한줄 앱 (Android)

### 프로젝트 경로
- `C:\spam\`
- APK: `C:\spam\app\build\outputs\apk\debug\app-debug.apk`
- 빌드: `cd C:\spam && .\gradlew assembleDebug` (Android Studio 불필요)

### 주요 파일
| 파일 | 역할 |
|------|------|
| SmsReceiver.kt | SMS 수신 → 서버 리포트 (모든 SMS 전송, 필터 없음) |
| MmsReceiver.kt | LMS/MMS 수신 → downloadMultimediaMessage() → content://mms 읽기 → 서버 리포트 |
| MainActivity.kt | 설정 UI (서버URL, 토큰, 통신사, 전화번호, 디바이스 등록) |
| ComposeSmsActivity.kt | 기본 SMS 앱 필수 더미 Activity |
| HeadlessSmsSendService.kt | 기본 SMS 앱 필수 더미 Service |
| AndroidManifest.xml | receiver/service 등록, 권한 선언 |

### ⚠️ LMS 수신 핵심 (기본 SMS 앱 설정 불필요!)
- **기본 SMS 앱 설정 없이 LMS 수신 성공 확인됨 (2026-02-20)**
- 기본 SMS 앱 아닌 상태 → 시스템이 MMS 자동 다운로드 → `WAP_PUSH_RECEIVED` → content://mms에서 읽기 → 서버 리포트
- 기본 SMS 앱인 상태 → `WAP_PUSH_DELIVER` → 시스템이 다운로드 안 해줌 → BroadcastReceiver 제약으로 직접 다운로드도 어려움
- **결론: 기본 SMS 앱 설정 안 하는 것이 안정적. 테스트폰 3대 모두 기본 메시지 앱 유지**
- SMS는 어느 상태든 intent에 내용이 바로 담겨서 문제없음

### MmsReceiver.kt 동작 흐름 (2026-02-20 최종)
```
[기본 SMS 앱 아닌 상태 — 권장]
1. WAP_PUSH_RECEIVED 브로드캐스트 수신
2. 시스템이 MMS 자동 다운로드 (앱 개입 불필요)
3. 5초 대기 → content://mms에서 최근 120초 이내 MMS 조회
4. getMmsSender() → 발신번호 추출 (addr type=137)
5. getMmsBody() → 본문 추출 (content type=text/plain)
6. sendReport() → 서버에 POST /api/spam-filter/report

[기본 SMS 앱인 상태 — 비권장]
1. WAP_PUSH_DELIVER 브로드캐스트 수신
2. Content-Location URL 추출 → downloadMultimediaMessage() 호출
3. 5초 대기 → content://mms 읽기 → 서버 리포트
※ BroadcastReceiver 내 registerReceiver 불가 → 콜백 방식 사용 불가
※ FileProvider 설정 필요 (file_paths.xml + AndroidManifest)
```

### 앱 설정값 (SharedPreferences: spam_hanjul)
| 키 | 기본값 |
|----|--------|
| server_url | https://hanjul.ai |
| api_token | spam-hanjul-secret-2026 |
| carrier | (설정 필요) |
| phone | (설정 필요) |
| device_id | Android ANDROID_ID 자동 |
| is_registered | false → 등록 후 true |

---

## 080 관련 변경 이력
1. **초기**: 메시지에 `0807196700` 하드코딩하여 앱에서 필터링 → 080 번호 자체가 스팸필터에 걸리는 문제 발견
2. **변경**: 080 치환 제거 → 원본 메시지 그대로 발송 → 앱도 필터 없이 모든 수신 메시지를 서버에 리포트
3. **매칭 방식**: 발신번호(callback_number) 기반 직접 매칭 → 발신번호 + 메시지내용 매칭으로 개선 (2026-02-20)
4. **DB DEFAULT**: spam_filter_tests.spam_check_number → NULL (사용 안 함)
   - ⚠️ 과거 잘못된 DEFAULT `08071906700` 존재했었음 (0 하나 더 끼어있던 버그, 수정 완료)

---

## 변경 이력

### 2026-02-20
| 항목 | 변경 내용 |
|------|----------|
| spam-filter.ts | 타임아웃 판정 → **15초 폴링으로 변경**. QTmsg 성공 + 앱 미수신 = 즉시 blocked. 3분 기다리지 않음 |
| spam-filter.ts | MySQL 조회 시 현재 큐(SMSQ_SEND_10) + 월별 로그(SMSQ_SEND_10_YYYYMM) 양쪽 조회 |
| spam-filter.ts | 리포트 매칭 로직 개선 — 발신번호만 → 발신번호 + 메시지내용(normalize). 동시 테스트 정합성 확보 |
| MmsReceiver.kt | 기본 SMS 앱 설정 **불필요** 확인. WAP_PUSH_RECEIVED + 시스템 자동 다운로드로 LMS 수신 성공 |
| MmsReceiver.kt | BroadcastReceiver 내 registerReceiver 불가 (ReceiverCallNotAllowedException) 교훈 |
| MmsReceiver.kt | downloadMultimediaMessage() contentUri null 불가 — FileProvider URI 필요 교훈 |
| 테스트폰 | 3대(SKT/KT/LGU+) 모두 기본 SMS 앱 설정 해제, 기본 메시지 앱 유지 상태로 운영 |
| Agent 10 잔액 | status_code 55 (E_BILL_LIMIT_OVER) 발생 → QTmsg 중계서버 선불 잔액 충전으로 해결 |
| DB DEFAULT | spam_filter_tests.spam_check_number DEFAULT `08071906700` (잘못된 번호) → NULL로 수정 |

### 2026-02-19
| 항목 | 변경 내용 |
|------|----------|
| 스팸필터 판정 고도화 | result 세분화 (received/blocked/failed/timeout), 타임아웃 180초, QTmsg 결과 조회 |
| 스팸한줄 앱 LMS 지원 | MmsReceiver.kt 추가, 기본 SMS 앱 컴포넌트 (ComposeSmsActivity, HeadlessSmsSendService) |
| 080 치환 제거 | 메시지 원본 그대로 발송, 앱 필터 제거, 발신번호 기반 매칭으로 전환 |

### ⚠️ 반복 실수 방지 체크리스트
- [ ] 테스트폰 3대 모두 **기본 SMS 앱 설정 해제** 상태 확인 (기본 메시지 앱으로 유지!)
- [ ] 앱에 080 번호 하드코딩 필터가 없는지 확인 (있으면 수신 누락)
- [ ] Agent 10 잔액 충전 상태 확인 (status_code 55 = 잔액부족)
- [ ] spam_filter_tests.spam_check_number DEFAULT가 NULL인지 확인
- [ ] 테스트폰 모바일 데이터 켜짐 확인 (LMS 다운로드에 필요)
- [ ] BroadcastReceiver 안에서 registerReceiver 사용 금지 (ReceiverCallNotAllowedException)
- [ ] downloadMultimediaMessage() 호출 시 contentUri에 FileProvider URI 필수 (null 불가)

---

## 디버깅 명령어 모음

### 1단계: 테스트 건 확인 (PostgreSQL)
```sql
docker exec -it targetup-postgres psql -U targetup targetup -c "
SELECT id, status, callback_number, created_at, completed_at
FROM spam_filter_tests ORDER BY created_at DESC LIMIT 5;
"
```

### 2단계: 통신사별 결과 확인
```sql
docker exec -it targetup-postgres psql -U targetup targetup -c "
SELECT carrier, message_type, received, result
FROM spam_filter_test_results
WHERE test_id = (SELECT id FROM spam_filter_tests ORDER BY created_at DESC LIMIT 1);
"
```

### 3단계: MySQL 발송 상태 (현재 큐)
```sql
docker exec -it targetup-mysql mysql -usmsuser -psms123 smsdb -e "
SELECT seqno, dest_no, call_back, msg_type, rsv1, status_code, sendreq_time, mobsend_time
FROM SMSQ_SEND_10 ORDER BY seqno DESC LIMIT 10;
"
```

### 4단계: MySQL 결과 로그 (Agent 이동 후)
```sql
docker exec -it targetup-mysql mysql -usmsuser -psms123 smsdb -e "
SELECT seqno, dest_no, msg_type, rsv1, status_code, mobsend_time, repmsg_recvtm
FROM SMSQ_SEND_10_202602 ORDER BY seqno DESC LIMIT 10;
"
```

### 5단계: Agent 10 로그
```bash
grep -i "error\|fail\|reject\|잔액\|ack" /home/administrator/agent10/logs/*mtdeliver.txt | tail -20
```

### 6단계: 앱 리포트 수신 확인
```bash
pm2 logs --lines 50 2>&1 | grep -i "report\|spam"
```

### 7단계: 디바이스 상태
```sql
docker exec -it targetup-postgres psql -U targetup targetup -c "
SELECT device_id, carrier, phone, is_active, last_seen_at FROM spam_filter_devices ORDER BY carrier;
"
```
