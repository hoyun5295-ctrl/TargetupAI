# TargetUP AI - AI 마케팅 자동화 솔루션 MVP v2.0

🎯 Claude API 연동으로 더 똑똑해진 타겟팅 + 문안 생성 자동화 솔루션

## 🆕 v2.0 신규 기능

| 기능 | v1.0 (규칙 기반) | v2.0 (AI 연동) |
|------|-----------------|----------------|
| 자연어 파싱 | Regex 패턴 매칭 | **Claude API 이해** |
| 문안 생성 | 템플릿 기반 | **브랜드 톤 맞춤 AI 생성** |
| 학습 | 없음 | **RAG: 과거 캠페인 참조** |
| 모드 전환 | 불가 | **AI ↔ 규칙 토글** |

## 🚀 빠른 시작

### 1. 설치

```bash
cd targetup
pip install -r requirements.txt
```

### 2. API 키 설정 (AI 모드 사용시)

```bash
# .env 파일 생성
cp .env.example .env

# API 키 입력
# ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

API 키 발급: https://console.anthropic.com → API Keys → Create Key

### 3. 실행

```bash
streamlit run app.py
```

브라우저에서 `http://localhost:8501` 접속

## 🤖 AI 모드 vs 규칙 모드

### AI 모드 (API 키 필요)
- ✅ 자유로운 자연어 이해
- ✅ 브랜드 톤앤매너 반영 문안
- ✅ 과거 캠페인 학습 (RAG)
- ✅ 페르소나 맞춤 메시지

### 규칙 모드 (API 키 불필요)
- ✅ 안정적인 패턴 매칭
- ✅ 오프라인 동작
- ✅ 예측 가능한 결과
- ✅ 무료

**모드 전환**: 사이드바에서 토글로 전환 가능

## 📝 프롬프트 예시

### 기본 예시
```
2026-02-10 10시 산뜻크림 30% 할인행사. 서울 20대 여성 중 최근 12개월 구매했고 
최근 6개월 미구매이며, 눈가케어+에센스 구매이력 고객에게 발송 예약.
```

### AI 모드에서 더 자유로운 표현
```
다음주 화요일 오전에 서울 사는 20대 여자분들 중에서 
작년에 한번이라도 샀는데 요즘 안 오시는 분들한테 
아이크림이랑 세럼 둘 다 사신 분들께만 30% 할인 문자 보내줘
```

## 🧠 RAG 학습 시스템

캠페인을 예약 저장할 때마다 자동으로 학습됩니다:

1. **저장**: 캠페인 정보 + 문안 → 벡터DB (ChromaDB)
2. **검색**: 새 캠페인 생성 시 유사 캠페인 자동 검색
3. **참조**: AI가 과거 성공 문안 패턴 참고하여 생성

### 성과 피드백 (향후)
```python
# 발송 후 CTR/전환율 업데이트
from core import rag_store
rag_store.update_performance(campaign_id=1, ctr=3.5, conversion_rate=1.2)
```

## 📁 프로젝트 구조

```
targetup/
├── app.py                    # Streamlit 메인 앱
├── .env                      # API 키 설정 (직접 생성)
├── .env.example              # 설정 예시
├── requirements.txt
├── README.md
├── core/
│   ├── models.py             # 데이터 클래스
│   ├── data_store.py         # 50만 고객 데이터
│   ├── query_engine.py       # 규칙 기반 파서
│   ├── recommender.py        # 규칙 기반 문안
│   ├── campaign_db.py        # SQLite
│   ├── scheduler.py          # 예약 처리
│   │
│   │  # AI 모듈 (v2.0)
│   ├── llm_client.py         # Claude API 클라이언트
│   ├── ai_parser.py          # AI 자연어 파싱
│   ├── ai_recommender.py     # AI 문안 생성
│   ├── rag_store.py          # RAG 벡터 저장소
│   └── engine.py             # 통합 엔진
├── scripts/
│   └── reset.py
└── data/                     # (자동 생성)
    ├── customers.parquet     # 50만 고객
    ├── purchases.parquet     # 200만 구매
    ├── campaigns.db          # 캠페인 DB
    └── rag/                   # RAG 벡터DB
```

## 💰 API 비용 예상

| 기능 | 호출/월 | 비용 |
|------|---------|------|
| 자연어 파싱 | 1,000회 | ~$5 |
| 문안 생성 | 1,000회 | ~$15 |
| RAG 임베딩 | 10,000건 | ~$1 |
| **월 합계** | | **~$20 (3만원)** |

## 🔧 설정 옵션

`.env` 파일에서 설정:

```bash
# 필수
ANTHROPIC_API_KEY=sk-ant-api03-...

# 선택 (기본값 있음)
CLAUDE_MODEL=claude-sonnet-4-20250514
BRAND_NAME=아이소이
BRAND_TONE=자연주의, 따뜻함, 신뢰, 전문성
ENABLE_RAG=true
RAG_TOP_K=3
```

## 테스트

### ANY vs ALL 차이 확인
```python
# AI 모드
"서울 여성 중 눈가케어+에센스 구매이력 고객"  # ALL (교집합)
"서울 여성 중 눈가케어 또는 에센스 구매이력 고객"  # ANY (합집합)
```

### API 연결 테스트
```python
from core import check_api_status
print(check_api_status())
# {'ready': True, 'message': 'Claude API 준비 완료!'}
```

## 리셋 옵션

```bash
# 데이터만 삭제
python scripts/reset.py --data

# DB만 삭제 (캠페인 + RAG)
python scripts/reset.py --db

# 전체 삭제
python scripts/reset.py --all

# 데이터 재생성
python scripts/reset.py --regenerate
```

## 트러블슈팅

### API 키 오류
```
⚠️ API 키 형식이 올바르지 않습니다
```
→ `sk-ant-api03-`으로 시작하는지 확인

### ChromaDB 오류
```
⚠️ ChromaDB 미설치
```
→ `pip install chromadb`

### 데이터 로드 느림
첫 실행 시 50만 고객 + 200만 구매 생성에 2-3분 소요
→ 이후 Parquet 캐시로 빠른 로드

---

**TargetUP AI v2.0** by INVITO Corp © 2026

Claude API Powered 🤖
