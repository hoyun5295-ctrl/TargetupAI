"""
TargetUP AI - Core Module
"""
from .models import FilterSpec, MessageVariant, Campaign, CATEGORIES, REGIONS, SKIN_TYPES
from .data_store import data_cache, load_or_generate_data
from .query_engine import query_engine, QueryEngine
from .recommender import message_recommender, MessageRecommender
from .campaign_db import campaign_db, CampaignDB
from .scheduler import scheduler, CampaignScheduler

# AI 모듈
from .llm_client import claude_client, check_api_status
from .ai_parser import ai_parser, parse_with_ai
from .ai_recommender import ai_recommender, generate_messages_with_ai
from .rag_store import rag_store, add_campaign_to_rag, search_similar_campaigns
from .engine import unified_engine, execute_query, recommend_messages, get_engine_status

__all__ = [
    # 모델
    'FilterSpec', 'MessageVariant', 'Campaign',
    'CATEGORIES', 'REGIONS', 'SKIN_TYPES',
    
    # 데이터
    'data_cache', 'load_or_generate_data',
    
    # 규칙 기반 엔진
    'query_engine', 'QueryEngine',
    'message_recommender', 'MessageRecommender',
    
    # DB
    'campaign_db', 'CampaignDB',
    'scheduler', 'CampaignScheduler',
    
    # AI 모듈
    'claude_client', 'check_api_status',
    'ai_parser', 'parse_with_ai',
    'ai_recommender', 'generate_messages_with_ai',
    'rag_store', 'add_campaign_to_rag', 'search_similar_campaigns',
    
    # 통합 엔진
    'unified_engine', 'execute_query', 'recommend_messages', 'get_engine_status',
]
