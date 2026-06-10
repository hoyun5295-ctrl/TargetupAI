# 알림톡 강조표기형 7300 — IMC 답변 후 처리 핸드오프 (2026-06-09)

> 근본 원인 확정 + IMC 확인 메일 발송 대기 상태에서 세션 종료. IMC 답변 받으면 이 문서 분기대로 처리.
> 상세 추적 기록 = `memory/project_2026_0609_alimtalk_emphasize_etcjson_diagnosis.md` + `status/lessons/LESSONS_BACKEND.md` D234+.

## 1. 확정된 근본 원인

발송 에이전트 QTmsg(`/home/administrator/agent1~11/bin`, java 11개, PM2 아님)의 `conf/qtmsg.xml` `<select_sql>`:

```sql
case
when k_etc_json = '' or k_etc_json is null then
      concat(concat('{"sendercode":"',sender_code), '"}')
else
      concat(concat(concat('{"sendercode":"',sender_code), '",'), replace(k_etc_json,'{',''))
end as k_etc_json
```

- `sender_code` = 인비토(특수유형 부가통신사업자) 식별코드. 한줄로 `insertAlimtalkQueue`/`bulkInsertSmsQueue`가 이 컬럼을 **안 채움** → NULL.
- MySQL `concat`은 인자 하나만 NULL이어도 전체 NULL → **k_etc_json 통째 NULL** → 강조 title 소실 → 카카오 7300.
- 채널추가형·기본형은 etcJson 불요 → 무증상. 강조표기형만 죽음.
- 증거: `SMSQ_SEND_1_202606`에 강조형 행 `k_etc_json={"title":"…"}` 정상 + `sender_code NULL` + `status_code 7300`.

## 2. 이 세션에서 한줄로 쪽에 이미 반영된 것 (배포됨)

1. `buildAlimtalkEtcJson` CT(utils/alimtalk-emphasize.ts) — senderkey 제거, `{"title":치환값}`만 생성 (QTmsg 매뉴얼 232행 부합). 호출 5경로(campaigns 1363 commit·2018 즉시 / direct-send-processor 231 staging / auto-campaign-worker 967 / journey-executor 716) 통일. 테스트 5 assertions.
2. 진단 로그 `[ALIMTALK-DEBUG2]` — direct-send-processor.ts `insertAlimtalkQueue` 호출 직전. **원인 종결 후 제거 의무.**

## 3. IMC에 보낸 확인 질문 (서팀장 메일)

1. 인비토 식별코드 값 + 발송 시 우리가 어디에 넣어야 하는지 / 중계사 자동인지
2. 일반 문자(SMS/LMS)는 우리가 안 넣는데도 잘 나감 — 중계사 자동 삽입 맞는지
3. 카카오 알림톡/친구톡은 식별코드 불필요 맞는지 → 불필요면 select_sql의 sendercode 합침 빼도 되는지
4. 한줄로에서 식별코드 관련 추가 설계·세팅 필요한 게 있는지
5. 알림톡 강조표기형 etcJson 정확한 형식 (title만 vs title+subtitle)

## 4. 답변별 처리 분기

### A. "카카오는 식별코드 불필요" (예상 1순위)
- agent1~11 `conf/qtmsg.xml` select_sql에서 sendercode 합침 제거, 또는 sender_code NULL이면 k_etc_json 그대로 통과:
```sql
case
when k_etc_json = '' or k_etc_json is null then
     case when sender_code is null or sender_code = '' then null
          else concat('{"sendercode":"', sender_code, '"}') end
else
     case when sender_code is null or sender_code = '' then k_etc_json
          else concat('{"sendercode":"', sender_code, '",', replace(k_etc_json,'{','')) end
end as k_etc_json
```
- 11개 에이전트 전부 동일 수정 + 재기동(`bin/stop.sh`→`start.sh`, Harold 직접). 한줄로 코드 수정 0.

### B. "카카오도 식별코드 필요, 한줄로가 sender_code 채워야"
- IMC가 준 인비토 식별코드 값(varchar 9)을 ENV(예: `INVITO_SENDER_CODE`)로.
- `insertAlimtalkQueue`(+필요 시 `bulkInsertSmsQueue` 등 전 발송 경로) INSERT에 `sender_code` 컬럼 추가.
- 고객사별 별도 식별코드가 필요해지면(고객사가 특수유형 사업자인 경우) companies 컬럼+슈퍼관리자 입력 설계 별건.

### C. "문자도 자동 아님, 전부 우리가 넣어야"
- B와 동일하되 SMS/LMS/MMS 경로(`bulkInsertSmsQueue`·`insertTestSmsQueue` 등) 포함 전수.

### D. etcJson 형식이 title+subtitle이면
- `buildAlimtalkEtcJson`에 subtitle 추가(kakao_templates.emphasize_subtitle 전달) — 호출 5경로 + 테스트 갱신.

### 공통 마무리
1. 강조형 1건 테스트 → `SMSQ_SEND_1_202606`에서 `k_etc_json`·`status_code=1000번대` 확인.
2. 진단 로그 `[ALIMTALK-DEBUG2]` 제거(direct-send-processor.ts).
3. `memory/project_2026_0609_alimtalk_emphasize_etcjson_diagnosis.md` + `status/BUGS.md` + `STATUS.md` CURRENT_TASK 종결 갱신.
