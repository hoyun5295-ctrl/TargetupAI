"""
TargetUP AI - Unified Engine
AI 모드와 규칙 기반 모드 통합
"""
from datetime import datetime
from typing import Tuple, List, Set, Optional, Dict, Any
import pandas as pd

from .models import FilterSpec, MessageVariant
from .data_store import data_cache
from .query_engine import query_engine, QueryEngine
from .recommender import message_recommender
from .llm_client import claude_client, check_api_status
from .ai_parser import ai_parser
from .ai_recommender import ai_recommender
from .rag_store import rag_store, search_similar_campaigns


class UnifiedEngine:
    """
    통합 엔진
    
    AI API가 사용 가능하면 AI 모드, 아니면 규칙 기반 모드
    """
    
    def __init__(self):
        self._rule_engine = QueryEngine()
    
    @property
    def ai_available(self) -> bool:
        """AI API 사용 가능 여부"""
        return claude_client.is_available
    
    @property
    def rag_available(self) -> bool:
        """RAG 사용 가능 여부"""
        return rag_store.is_available
    
    def get_mode(self) -> str:
        """현재 모드 반환"""
        if self.ai_available:
            return "AI"
        return "RULE"
    
    def execute(self, 
                prompt: str,
                use_ai: Optional[bool] = None) -> Tuple[FilterSpec, datetime, int, pd.DataFrame, List[str], Dict[str, Any]]:
        """
        쿼리 실행
        
        Args:
            prompt: 사용자 프롬프트
            use_ai: AI 사용 여부 (None이면 자동)
            
        Returns:
            (spec, send_at, total_count, sample_df, customer_ids, extra_context)
        """
        # 데이터 로드 확인
        if not data_cache.is_loaded:
            data_cache.load()
        
        # AI 모드 결정
        if use_ai is None:
            use_ai = self.ai_available
        
        extra_context = {}
        
        if use_ai and self.ai_available:
            # AI 파싱
            try:
                spec, send_at, extra_context = ai_parser.parse(prompt)
            except Exception as e:
                print(f"AI 파싱 실패, 규칙 기반으로 폴백: {e}")
                spec, send_at = self._rule_engine.parser.parse(prompt)
        else:
            # 규칙 기반 파싱
            spec, send_at = self._rule_engine.parser.parse(prompt)
        
        # 필터링 (항상 규칙 기반 - 정확성 보장)
        customer_ids = self._rule_engine._filter_customers(spec)
        total_count = len(customer_ids)
        
        # 샘플 추출
        sample_ids = list(customer_ids)[:50]
        sample_df = data_cache.customers[
            data_cache.customers['customer_id'].isin(sample_ids)
        ].copy()
        
        # 나이 컬럼 추가
        current_year = datetime.now().year
        sample_df['age'] = current_year - sample_df['birth_year']
        
        return spec, send_at, total_count, sample_df, list(customer_ids), extra_context
    
    def recommend_messages(self,
                           prompt: str,
                           spec: FilterSpec,
                           send_at: datetime,
                           extra_context: Optional[Dict[str, Any]] = None,
                           use_ai: Optional[bool] = None,
                           use_rag: bool = True) -> List[MessageVariant]:
        """
        문안 추천
        
        Args:
            prompt: 원본 프롬프트
            spec: 타겟팅 조건
            send_at: 발송일시
            extra_context: 추가 컨텍스트
            use_ai: AI 사용 여부
            use_rag: RAG 사용 여부
            
        Returns:
            점수순 정렬된 MessageVariant 리스트
        """
        if use_ai is None:
            use_ai = self.ai_available
        
        # RAG에서 유사 캠페인 검색
        past_campaigns = None
        if use_rag and self.rag_available:
            past_campaigns = search_similar_campaigns(prompt, spec)
        
        if use_ai and self.ai_available:
            # AI 문안 생성
            try:
                return ai_recommender.recommend(
                    prompt, spec, send_at, extra_context, past_campaigns
                )
            except Exception as e:
                print(f"AI 문안 생성 실패, 규칙 기반으로 폴백: {e}")
        
        # 규칙 기반 문안 생성
        return message_recommender.recommend(prompt, spec, send_at)
    
    def get_spec_tags(self, spec: FilterSpec) -> List[Dict[str, str]]:
        """조건 태그 반환"""
        return self._rule_engine.get_spec_tags(spec)
    
    def get_status(self) -> Dict[str, Any]:
        """엔진 상태 반환"""
        api_status = check_api_status()
        rag_stats = rag_store.get_stats()
        
        return {
            "mode": self.get_mode(),
            "ai_available": self.ai_available,
            "rag_available": self.rag_available,
            "api_status": api_status,
            "rag_stats": rag_stats,
            "data_loaded": data_cache.is_loaded
        }


# 싱글톤 인스턴스
unified_engine = UnifiedEngine()


# 편의 함수들
def execute_query(prompt: str, use_ai: Optional[bool] = None):
    """쿼리 실행"""
    return unified_engine.execute(prompt, use_ai)


def recommend_messages(prompt: str, 
                       spec: FilterSpec, 
                       send_at: datetime,
                       extra_context: Optional[Dict[str, Any]] = None,
                       use_ai: Optional[bool] = None):
    """문안 추천"""
    return unified_engine.recommend_messages(prompt, spec, send_at, extra_context, use_ai)


def get_engine_status():
    """엔진 상태"""
    return unified_engine.get_status()
