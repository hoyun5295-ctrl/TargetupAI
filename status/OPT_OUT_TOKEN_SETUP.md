# OPT_OUT_080_TOKEN 실서버 설정 가이드

**작성일:** 2026-03-05
**대상:** 상용서버 (58.227.193.62)
**기간계 영향:** 없음 (080 수신거부 콜백 전용, 발송 시스템 무관)

---

## 배경

전수점검(2026-03-05)에서 STATUS.md에는 완료([x]) 표시였으나, 실서버 .env에 `OPT_OUT_080_TOKEN` 환경변수가 실제로 없음을 확인했습니다. 이 토큰이 없으면 나래인터넷 080 수신거부 콜백 요청의 인증이 작동하지 않습니다.

## 실행 절차

```bash
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app

# 1. 현재 .env 확인 (OPT_OUT_080_TOKEN 유무)
grep OPT_OUT_080_TOKEN .env

# 2. 토큰이 없으면 추가 (토큰값은 나래인터넷과 협의된 값 사용)
echo '' >> .env
echo '# 080 수신거부 콜백 인증 토큰 (나래인터넷)' >> .env
echo 'OPT_OUT_080_TOKEN=여기에_나래와_협의된_토큰값' >> .env

# 3. PM2 재시작 (백엔드가 새 환경변수를 읽도록)
pm2 restart all

# 4. 확인
pm2 status
grep OPT_OUT_080_TOKEN .env
```

## 토큰값 확인 방법

나래인터넷 담당자에게 아래 확인 필요:
1. 콜백 URL 등록 완료 여부 (2/27 이후 미확인 상태)
2. 인증 토큰값 (양측 동일해야 함)
3. 실제 테스트: 080-719-6700 ARS 수신거부 → 콜백 수신 확인

## 설정 후 STATUS.md 업데이트

설정 완료 후 STATUS.md Line 604를 `[x]`로 변경:
```
- [x] 서버 .env OPT_OUT_080_TOKEN 설정 + PM2 재시작 — ✅ 설정완료(YYYY-MM-DD)
```
