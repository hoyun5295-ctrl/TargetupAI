# Sync Agent Linux 로컬 테스트 (WSL Ubuntu)

더미 데이터 20,000건(`가상고객DB_20000건.xlsx` 기반)을 Sync Agent Linux 바이너리로
한줄로 서버(app.hanjul.ai)에 동기화하는 테스트 절차.

---

## 사전 준비 (Harold님 직접 작업)

### 1. 한줄로 서버에 테스트 회사 등록 → API 키 발급
1. https://sys.hanjullo.com (슈퍼관리자) 접속
2. **회사 관리 → + 회사 추가** (또는 기존 "테스트계정2" 활용)
3. 회사 생성 시 **API Key + API Secret 자동 발급** → 반드시 복사해 둘 것
4. `is_system=true` 가상 사용자도 자동 생성됨 (오늘 패치로 UI에서는 숨겨짐)
5. (옵션) 동일 UI에서 동기화 주기·브랜드 코드 등 확인

### 2. 데이터 입력 방식 설정
- 회사 상세 → **데이터 입력 방식 = sync_agent** 로 설정되어 있어야 함

---

## WSL에서 실행

```bash
# Windows PowerShell에서
wsl -d Ubuntu

# WSL Ubuntu 진입 후
bash /mnt/c/Users/ceo/projects/targetup/sync-agent/test-data/setup-wsl.sh
```

셋업 스크립트가:
- `~/sync-agent-test/` 폴더 생성
- Linux 바이너리 복사 + 실행 권한 부여
- CSV 20,000건 + 샘플 100건 복사
- `data/config.json` 템플릿 복사

### Config 채우기
```bash
nano ~/sync-agent-test/data/config.json
# 또는
vi ~/sync-agent-test/data/config.json
```

2곳 교체:
- `"apiKey": "__PLACEHOLDER_API_KEY__"` → 발급받은 API Key
- `"apiSecret": "__PLACEHOLDER_API_SECRET__"` → 발급받은 API Secret

### 소규모 먼저 테스트 (권장)
100건 샘플로 매핑·인증·네트워크 먼저 검증:
```json
"filePath": "./test-data/customers_sample_100.csv",
```

### 실행
```bash
cd ~/sync-agent-test
./sync-agent
```

---

## 기대 동작

1. **첫 실행**: `config.json` 감지 → `agent.key` 자동 생성 → `config.enc`로 암호화 → 평문 `config.json` 삭제
2. **서버 인증**: API Key/Secret로 HMAC 인증 → `GET /api/sync/version` 등 핸드셰이크
3. **CSV 소스 연결**: `xlsx`/`papaparse` 동적 로드 → 파일 읽기 → 20컬럼 매핑 적용
4. **정규화**: `normalize/index.ts` 디스패처 — phone/email/date/amount 정규화, grade는 원본 보존(`trim`)
5. **배치 업로드**: `batchSize=4000` 단위 → `POST /api/sync/customers` 5회로 20,000건
6. **heartbeat**: 동기화 완료 후 주기적 heartbeat

서버 UI(고객사관리자 → 고객 관리)에서 20,000건 보이면 성공.

---

## 검증 포인트

- ✅ 한글 인코딩 (UTF-8 BOM): 이름, 주소, "동의/거부" 등 한글이 `?`로 깨지지 않음
- ✅ grade 원본 보존: DB에 `VIP`/`SILVER`/`NORMAL` 영문 enum 그대로 (방금 적용한 D131 후속)
- ✅ 수신동의 11종 정규화: `Y`/`O`/`동의`/`수신동의` → true, `N`/`X`/`거부`/`수신거부`/`미동의` → false
- ✅ 매장전화번호 유선번호 유지: `02-771-2500` 등 하이픈 보존 (`normalizeStorePhone`)
- ✅ 생년월일: `1994-03-24` YYYY-MM-DD 포맷
- ✅ 선호스타일 → `custom_1` 커스텀 슬롯에 저장 + 라벨 "선호스타일" 등록
- ✅ 포인트: 쉼표 없는 숫자 → 그대로 INT 저장
- ✅ 2차 실행 시 **증분 동기화** — 파일 해시 동일하면 업로드 0건 (변경된 행만 전송)

---

## 문제 발생 시 로그 확인

```bash
tail -f ~/sync-agent-test/logs/*.log
# 또는
ls -lah ~/sync-agent-test/logs/
```

주요 에러 유형:
- `1053`: 서비스 시작 실패 (v1.5.1 패치 완료 — 재발 시 `CWD` 관련 로그 확인)
- `401/403`: API Key/Secret 오류
- `NORMALIZE_FAILED`: 특정 행 정규화 실패 — 로그에서 행 번호 + 사유 확인
- `network`: app.hanjul.ai 접근 불가 (WSL 네트워크 or 방화벽)

---

## 다음 단계 (옵션 A: Docker MySQL 실전 시뮬레이션)

Excel-CSV 테스트가 통과하면 실전과 동일한 MSSQL/MySQL 구조로 재테스트:
1. Docker로 MySQL 8 컨테이너 실행
2. CSV → `LOAD DATA LOCAL INFILE` import
3. `config.json` → `"type": "mysql"` 로 변경 + host/user/password/database 입력
4. 증분 동기화 (updated_at 기준) 검증
