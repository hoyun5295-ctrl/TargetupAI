# 기존 INVITO 웹 — 전환 전 관리 문서

> **목적:** 한줄로(Target-UP) 전환 완료 시까지 기존 웹 유지 관리
> **관련 문서:** STATUS.md | OPS.md | SCHEMA.md
> **최종 업데이트:** 2026-02-22 (서버 점검 + 디스크 정리 + SSL 적용 완료)

---

## 1) 현황 요약

| 항목 | 내용 |
|------|------|
| 기술 스택 | eGov(전자정부) + Spring + Oracle 11g + Nginx 1.6.3 + Tomcat 6 + Java 1.7 |
| 호스팅 | 다우클라우드 서버 |
| 로컬 소스 경로 | `C:\INVITO_web` |
| 서버 소스 경로 | `/www/usom/WebContent` (18G) |
| 도메인 | **invitobiz.com** (+ www.invitobiz.com) |
| 용도 | 고객사 메시지 발송 + 관리 (이니시스 PG 결제 포함) |
| 상태 | 운영 중 — 한줄로 전환 완료 시 폐기 예정 |

### ⚠️ 구형 경고 (전부 지원 종료)
| 소프트웨어 | 버전 | EOL |
|-----------|------|-----|
| CentOS | 7 | 2024-06-30 |
| Java | 1.7.0_45 | 2015-04 |
| Tomcat | 6 | 2016-12-31 |
| Nginx | 1.6.3 (SSL 모듈 재컴파일 완료) | 2015 |
| Oracle | 11g | 2020-12-31 |

---

## 2) 서버 접속 정보

### 2-1. SSH
| 항목 | 값 |
|------|-----|
| IP | 27.102.203.143 |
| 포트 | 27153 |
| 접속 계정 | root (프롬프트: usomweb) |
| 접속 명령 | `ssh -p 27153 root@27.102.203.143` |

### 2-2. Oracle DB
| 항목 | 값 |
|------|-----|
| SID | orcl |
| 포트 | 1521 (기본) |
| 계정 | usom_user |
| 비밀번호 | usom_user_7119 |
| 설치 경로 | /app/oracle/product/11g |
| 리스너 | /app/oracle/product/11g/bin/tnslsnr |
| 데이터 용량 | 120G (/app/oracle) |

### 2-3. MySQL
| 항목 | 값 |
|------|-----|
| 포트 | 3388 (비표준) |

### 2-4. 서비스 포트 맵
| 포트 | 서비스 | 비고 |
|------|--------|------|
| 80 | Nginx | → Tomcat6_b(8070) 프록시 |
| 8070 | Tomcat6_b | **메인 웹서비스** (invitobiz.com) |
| 8080 | Tomcat6 | 용도 확인 필요 |
| 1521 | Oracle | 리스너 |
| 3388 | MySQL | 비표준 포트 |
| 27153 | SSH | |
| 34483~34983 | QTmsg Agent x5 | 기존 인비토 발송 엔진 |

### 2-5. 원격 백업 서버
| 항목 | 값 |
|------|-----|
| IP | 58.227.193.59 |
| 포트 | 27616 |
| 계정 | backup |
| 비밀번호 | backup258!@# |
| 경로 | /home/backup/ |

---

## 3) 서버 사양 & 리소스 (2026-02-22 기준)

| 항목 | 값 |
|------|-----|
| OS | CentOS 7 (Core) |
| 메모리 | 31G (가용 17G) |
| Swap | 15G (3.7G 사용 중) |
| 디스크 | 425G / **249G 사용 / 155G 여유 (62%)** |

### 디스크 사용 분포
| 경로 | 용량 | 내용 |
|------|------|------|
| /www | 134G | 웹서비스 (소스 18G + 로그) |
| /app | 120G | Oracle DB + 설치 파일 |
| /home | 48G | invitoMsg(29G) + oracle(7G) + pkgs(7G) + tmp(3G) |
| /usr | 16G | 시스템 + Tomcat |
| /var | 5.8G | 시스템 로그 |

### 2026-02-22 디스크 정리 내역
| 작업 | 확보 용량 |
|------|----------|
| catalina.out 비우기 (Tomcat 로그) | 4.6G |
| 웹 로그 정리 (6개월 보존, 2025-08 이전 삭제) | 79G |
| **합계** | **약 84G** |
| 디스크 사용률 변화 | 82% → 62% |

> **주의:** 웹 로그(/www/usom/web-log/)는 자동 삭제 설정이 없어 계속 쌓임. 주기적 정리 필요.

---

## 4) 백업 체계

### 4-1. Oracle DB 백업
- **스케줄:** oracle 유저 crontab — 매월 5일 0시
- **스크립트:** `/home/oracle/backup/backup.sh`
- **방식:** `exp` (Oracle Export) → .dmp + .log 생성
- **전송:** `/home/oracle/backup/send_258.sh` → SCP로 58.227.193.59 원격 전송
- **로컬 보관:** 전송 후 로컬 dmp 삭제 (로컬에는 로그만 남음)

### 4-2. 백업 스크립트 내용
```bash
# backup.sh
_today=`date "+%Y%m%d%H"`
exp usom_user/usom_user_7119@orcl file=invito_${_today}.dmp log=invito_backup_${_today}.log

# send_258.sh
scp -P 27616 ./invito_*.* backup@58.227.193.59:/home/backup/
```

---

## 5) Nginx 설정 (현재)

- **설치 경로:** `/usr/local/nginx/` (소스 컴파일)
- **버전:** 1.6.3
- **✅ SSL 모듈 포함 재컴파일 완료** (2026-02-22)
- **백업:** `/usr/local/nginx/sbin/nginx_backup_20260222` (SSL 모듈 없는 원본)
- **설정 백업:** `/usr/local/nginx/conf_backup_20260222/`

### SSL 인증서 (ZeroSSL via acme.sh)
| 항목 | 값 |
|------|-----|
| 인증서 | /root/.acme.sh/invitobiz.com_ecc/fullchain.cer |
| 키 | /root/.acme.sh/invitobiz.com_ecc/invitobiz.com.key |
| 도메인 | invitobiz.com + www.invitobiz.com |
| 만료 | 2026-05-23 |
| 자동갱신 | acme.sh 크론잡 등록됨 |

### 현재 설정 (`/usr/local/nginx/conf/nginx.conf`)
```nginx
http {
    # HTTP -> HTTPS redirect
    server {
        listen       80;
        server_name  invitobiz.com www.invitobiz.com;
        return 301 https://$host$request_uri;
    }

    # HTTPS
    server {
        listen       443 ssl;
        server_name  invitobiz.com www.invitobiz.com;

        ssl_certificate      /root/.acme.sh/invitobiz.com_ecc/fullchain.cer;
        ssl_certificate_key  /root/.acme.sh/invitobiz.com_ecc/invitobiz.com.key;
        ssl_protocols TLSv1 TLSv1.1 TLSv1.2;
        ssl_ciphers HIGH:!aNULL:!MD5;

        client_max_body_size 20M;
        charset utf-8;

        location / {
            proxy_pass http://localhost:8070;
            proxy_connect_timeout 300;
            proxy_send_timeout 300;
            proxy_read_timeout 300;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /python {
            proxy_pass http://127.0.0.1:8090/$uri;
        }
    }

    # IP direct access
    server {
        listen       80;
        server_name  27.102.203.143;

        location / {
            proxy_pass http://localhost:8090;
        }
    }
}
```

---

## 6) ✅ SSL 적용 완료 (2026-02-22)

### 6-1. 해결된 문제
- ~~SSL 인증서 미적용 (HTTP만 운영)~~
- ~~이니시스 PG에서 특정 카드사(비자/마스터 등) 결제창 차단~~
- **고객 카드결제 복구됨** (이니시스 결제 테스트 필요)

### 6-2. 적용 내용
| 작업 | 상태 |
|------|------|
| Nginx SSL 모듈 재컴파일 | ✅ |
| SSL 인증서 발급 (ZeroSSL, acme.sh) | ✅ |
| HTTPS 설정 + HTTP→HTTPS 301 리다이렉트 | ✅ |
| 이니시스 PG 콜백 URL https 변경 | ✅ |
| 브라우저 "이 연결은 안전합니다" 확인 | ✅ |

### 6-3. 변경된 JSP 파일 (http → https)
- `/www/usom/WebContent/WEB-INF/cnp/front/mypage/pg/INIStdPayRequest.jsp` (76행)
- `/www/usom/WebContent/WEB-INF/cnp/front/mypage/INIsecurestart.jsp` (92행)
- `/www/usom/WebContent/index.jsp`
- `/www/usom/WebContent/WEB-INF/cnp/front/main/main_noti.jsp`

### 6-4. 롤백 방법 (만약 문제 시)
```bash
# Nginx 원복
cp /usr/local/nginx/sbin/nginx_backup_20260222 /usr/local/nginx/sbin/nginx
cp -r /usr/local/nginx/conf_backup_20260222/* /usr/local/nginx/conf/
/usr/local/nginx/sbin/nginx -s reload
```

---

## 7) 실행 중 서비스

### 7-1. Tomcat (2개)
| 인스턴스 | 포트 | 경로 | 메모리 | 역할 |
|---------|------|------|--------|------|
| Tomcat6 | 8080 | /usr/local/tomcat6 | 2G 할당 | 용도 확인 필요 |
| Tomcat6_b | 8070 | /usr/local/tomcat6_b | 2G 할당 (실사용 2.5G) | **메인 웹서비스** |

### 7-2. QTmsg Agent (5개)
| Agent | jar 파일 | 포트 |
|-------|---------|------|
| 1 | invitoMsg_auto.jar | 34583 |
| 2 | invitoMsg_web.jar | 34783 |
| 3 | invitoMsg_gyeongnam.jar | 34683 |
| 4 | invitoMsg_web1.jar | 34883 |
| 5 | invitoMsg_web2.jar | 34483 |
| 6 | invitoMsg_web3.jar | 34983 |

### 7-3. Oracle 프로세스
- 다수의 oracleorcl 세션 실행 중
- 주요 백그라운드: pmon, smon, dbw0/1, lgwr, ckpt, mmon 등

---

## 8) Oracle DB 리스크

### 8-1. 테이블스페이스 관리
- Oracle은 테이블스페이스 풀 차면 INSERT/UPDATE 멈춤 → 서비스 다운
- 주기적 정리 필요 (오래된 로그 DELETE + PURGE)
- 직원 전달: "자동 분할 설정되어 있음" → Autoextend 확인 필요
- 확인 방법 (sqlplus 접속 후):
```sql
sqlplus usom_user/usom_user_7119@orcl

SELECT tablespace_name,
       ROUND(used_percent, 1) AS used_pct
FROM dba_tablespace_usage_metrics
ORDER BY used_percent DESC;

SELECT file_name, tablespace_name, autoextensible,
       ROUND(bytes/1024/1024) AS size_mb,
       ROUND(maxbytes/1024/1024) AS max_mb
FROM dba_data_files;
```

### 8-2. 라이선스 리스크
- Oracle 무라이선스 사용 중 (감사 적발 시 소급 청구 위험)
- 대응: 한줄로 전환 완료 후 **Oracle 완전 삭제**로 리스크 제거

---

## 9) 유지보수 계약 정리 (2026년 2월 종료)

### 9-1. 인수 확보 정보
| # | 항목 | 확보 여부 |
|---|------|----------|
| 1 | 다우클라우드 서버 SSH 접속 정보 | [x] root@27.102.203.143:27153 |
| 2 | 다우클라우드 관리콘솔 로그인 | [ ] |
| 3 | Oracle DB 접속 정보 | [x] usom_user/usom_user_7119@orcl |
| 4 | 도메인 관리 계정 (등록업체 로그인, DNS 수정 권한) | [ ] |
| 5 | 이니시스 PG 관리자 계정 (상점 ID, 관리콘솔) | [ ] |
| 6 | 소스코드 최신본 확인 (`C:\INVITO_web`이 최신인지) | [ ] |
| 7 | 서버 크론잡/스케줄러 목록 | [x] oracle 매월5일 백업 |
| 8 | 백업 절차/위치 | [x] exp → SCP 58.227.193.59 |
| 9 | 원격 백업 서버 접속 정보 | [x] backup@58.227.193.59:27616 |

### 9-2. 인수 후 즉시 할 일
- [ ] SSH 비밀번호 변경
- [ ] DB 비밀번호 변경
- [x] 서버 현황 전체 점검 (2026-02-22 완료)
- [ ] Oracle 테이블스페이스 사용률 확인
- [x] 디스크 정리 (82% → 62%, 2026-02-22 완료)
- [x] SSL 적용 작업 (2026-02-22 완료)
- [ ] 웹 로그 자동 정리 크론잡 추가
- [ ] 이니시스 카드결제 실제 테스트

---

## 10) 전환 로드맵

| 단계 | 작업 | 상태 |
|------|------|------|
| 1 | 서버 접속 + 현황 파악 | ✅ 완료 (2026-02-22) |
| 2 | 디스크 정리 | ✅ 완료 (82% → 62%) |
| 3 | SSL 적용 → 이니시스 결제 복구 | ✅ 완료 (2026-02-22) |
| 4 | 유지보수 개인 개발자 계약 종료 + 접속정보 인수 | 진행 중 (2월 말) |
| 5 | 고객사 한줄로 직접발송으로 전환 가속 | 진행 중 |
| 6 | 전환 완료 확인 (기존 웹 트래픽 0 확인) | 미착수 |
| 7 | eGov 웹 서비스 종료 + Oracle 삭제 | 미착수 |
| 8 | 다우클라우드 서버 해지 (또는 용도 변경) | 미착수 |

---

## 11) 참고: 서버 파일 구조

```
/www/usom/                      ← 웹서비스 메인
├── WebContent/ (18G)           ← 소스 + 리소스
└── web-log/ (정리 후 ~37G)     ← 애플리케이션 로그 (6개월 보존)

/usr/local/nginx/               ← Nginx (소스컴파일, SSL 모듈 포함)
├── conf/nginx.conf             ← HTTPS 설정 적용됨
├── conf_backup_20260222/       ← SSL 적용 전 설정 백업
├── sbin/nginx                  ← SSL 모듈 포함 바이너리
├── sbin/nginx_backup_20260222  ← SSL 모듈 없는 원본 백업
└── logs/

/root/.acme.sh/                 ← SSL 인증서 관리 (자동갱신)
└── invitobiz.com_ecc/          ← 인증서 + 키

/home/tmp/nginx-1.6.3/          ← Nginx 소스 (컴파일용, 삭제 가능)

/usr/local/tomcat6/             ← Tomcat 인스턴스 1 (포트 8080)
/usr/local/tomcat6_b/           ← Tomcat 인스턴스 2 (포트 8070, 메인)

/app/oracle/ (120G)             ← Oracle 11g
├── product/11g/
└── admin/orcl/

/home/invitoMsg/ (29G)          ← QTmsg 발송 엔진
/home/oracle/                   ← Oracle 홈 + 백업 스크립트
/home/pkgs/ (6.9G)              ← 설치 패키지 (정리 가능)
/home/tmp/ (3.4G)               ← 임시 파일 (정리 가능)
```

---

## 12) 참고: 로컬 소스 프로젝트 구조

```
C:\INVITO_web\
├── WebContent\
│   ├── WEB-INF\
│   │   ├── classes\
│   │   │   ├── egovframework\    ← 전자정부 프레임워크 설정
│   │   │   ├── sql\              ← MyBatis SQL 매퍼
│   │   │   ├── mysql\            ← MySQL 연동 SQL
│   │   │   ├── config.properties ← 서버 설정
│   │   │   └── log4j.properties  ← 로그 설정
│   │   ├── config\               ← Spring MVC 설정
│   │   └── web.xml               ← 웹앱 설정
│   ├── app\                      ← 앱 업데이트
│   ├── css\                      ← 스타일
│   ├── js\                       ← 스크립트
│   ├── images\                   ← 이미지
│   └── web\                      ← 웹 페이지
├── main.jsp
└── favicon.ico
```
