"""
TargetUP AI - RAG Store
과거 캠페인/문안 학습을 위한 벡터 저장소
"""
import os
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path

# ChromaDB 임포트 시도
try:
    import chromadb
    from chromadb.config import Settings
    HAS_CHROMADB = True
except ImportError:
    HAS_CHROMADB = False

from .models import FilterSpec, Campaign


# RAG 저장소 경로
RAG_DIR = Path(__file__).parent.parent / "data" / "rag"


def ensure_rag_dir():
    """RAG 디렉토리 생성"""
    RAG_DIR.mkdir(parents=True, exist_ok=True)


class RAGStore:
    """
    RAG 벡터 저장소
    
    과거 캠페인 데이터를 저장하고 유사한 캠페인을 검색
    """
    
    def __init__(self):
        self._client = None
        self._collection = None
        self._enabled = os.getenv('ENABLE_RAG', 'true').lower() == 'true'
        self._top_k = int(os.getenv('RAG_TOP_K', '3'))
    
    @property
    def is_available(self) -> bool:
        """RAG 사용 가능 여부"""
        return HAS_CHROMADB and self._enabled
    
    def _ensure_initialized(self):
        """ChromaDB 초기화"""
        if not self.is_available:
            return
        
        if self._client is None:
            ensure_rag_dir()
            self._client = chromadb.PersistentClient(
                path=str(RAG_DIR),
                settings=Settings(anonymized_telemetry=False)
            )
            self._collection = self._client.get_or_create_collection(
                name="campaigns",
                metadata={"description": "TargetUP AI 캠페인 문안 저장소"}
            )
    
    def add_campaign(self, 
                     campaign_id: int,
                     prompt: str,
                     spec: FilterSpec,
                     sms_text: str,
                     lms_text: str,
                     total_count: int,
                     ctr: Optional[float] = None,
                     conversion_rate: Optional[float] = None):
        """
        캠페인 추가
        
        Args:
            campaign_id: 캠페인 ID
            prompt: 원본 프롬프트
            spec: 타겟팅 조건
            sms_text: SMS 문안
            lms_text: LMS 문안
            total_count: 타겟 모수
            ctr: 클릭률 (성과 피드백)
            conversion_rate: 전환율 (성과 피드백)
        """
        if not self.is_available:
            return
        
        self._ensure_initialized()
        
        # 문서 생성 (검색용)
        document = self._build_document(prompt, spec, sms_text)
        
        # 메타데이터
        metadata = {
            "campaign_id": campaign_id,
            "created_at": datetime.now().isoformat(),
            "gender": spec.gender or "all",
            "age_range": f"{spec.age_min or 0}-{spec.age_max or 100}",
            "regions": ",".join(spec.regions) if spec.regions else "all",
            "categories": ",".join(spec.categories) if spec.categories else "none",
            "category_mode": spec.category_mode,
            "is_churn_target": spec.not_purchased_within_months is not None,
            "total_count": total_count,
            "sms_text": sms_text[:500],  # ChromaDB 메타데이터 제한
            "lms_text": lms_text[:1000],
        }
        
        if ctr is not None:
            metadata["ctr"] = ctr
        if conversion_rate is not None:
            metadata["conversion_rate"] = conversion_rate
        
        # 저장
        self._collection.add(
            documents=[document],
            metadatas=[metadata],
            ids=[f"campaign_{campaign_id}"]
        )
    
    def search_similar(self,
                       prompt: str,
                       spec: FilterSpec,
                       top_k: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        유사 캠페인 검색
        
        Args:
            prompt: 검색할 프롬프트
            spec: 타겟팅 조건
            top_k: 반환할 결과 수
            
        Returns:
            유사 캠페인 목록
        """
        if not self.is_available:
            return []
        
        self._ensure_initialized()
        
        if self._collection.count() == 0:
            return []
        
        top_k = top_k or self._top_k
        
        # 검색 쿼리 생성
        query = self._build_document(prompt, spec, "")
        
        # 검색
        results = self._collection.query(
            query_texts=[query],
            n_results=min(top_k, self._collection.count())
        )
        
        # 결과 포맷팅
        campaigns = []
        if results and results['metadatas']:
            for i, metadata in enumerate(results['metadatas'][0]):
                campaign = {
                    "campaign_id": metadata.get("campaign_id"),
                    "target_desc": self._format_target_desc(metadata),
                    "sms_text": metadata.get("sms_text", ""),
                    "lms_text": metadata.get("lms_text", ""),
                    "total_count": metadata.get("total_count", 0),
                    "ctr": metadata.get("ctr"),
                    "conversion_rate": metadata.get("conversion_rate"),
                    "similarity_score": 1 - results['distances'][0][i] if results.get('distances') else None
                }
                campaigns.append(campaign)
        
        return campaigns
    
    def update_performance(self,
                           campaign_id: int,
                           ctr: Optional[float] = None,
                           conversion_rate: Optional[float] = None):
        """
        캠페인 성과 업데이트 (피드백 루프)
        
        Args:
            campaign_id: 캠페인 ID
            ctr: 클릭률
            conversion_rate: 전환율
        """
        if not self.is_available:
            return
        
        self._ensure_initialized()
        
        doc_id = f"campaign_{campaign_id}"
        
        try:
            # 기존 메타데이터 조회
            existing = self._collection.get(ids=[doc_id])
            if existing and existing['metadatas']:
                metadata = existing['metadatas'][0]
                
                # 성과 업데이트
                if ctr is not None:
                    metadata['ctr'] = ctr
                if conversion_rate is not None:
                    metadata['conversion_rate'] = conversion_rate
                
                # 업데이트
                self._collection.update(
                    ids=[doc_id],
                    metadatas=[metadata]
                )
        except Exception as e:
            print(f"성과 업데이트 실패: {e}")
    
    def get_stats(self) -> Dict[str, Any]:
        """저장소 통계"""
        if not self.is_available:
            return {"available": False, "message": "ChromaDB not installed"}
        
        self._ensure_initialized()
        
        return {
            "available": True,
            "total_campaigns": self._collection.count(),
            "storage_path": str(RAG_DIR)
        }
    
    def _build_document(self, prompt: str, spec: FilterSpec, sms_text: str) -> str:
        """검색용 문서 생성"""
        parts = [prompt]
        
        if spec.gender:
            parts.append(f"성별: {'여성' if spec.gender == 'F' else '남성'}")
        
        if spec.age_min is not None:
            parts.append(f"연령: {spec.age_min}대")
        
        if spec.regions:
            parts.append(f"지역: {', '.join(spec.regions)}")
        
        if spec.categories:
            parts.append(f"카테고리: {', '.join(spec.categories)}")
        
        if spec.not_purchased_within_months:
            parts.append("이탈 고객")
        
        if sms_text:
            parts.append(f"문안: {sms_text[:200]}")
        
        return " | ".join(parts)
    
    def _format_target_desc(self, metadata: Dict) -> str:
        """타겟 설명 포맷팅"""
        parts = []
        
        if metadata.get('gender') != 'all':
            parts.append('여성' if metadata['gender'] == 'F' else '남성')
        
        if metadata.get('age_range') != '0-100':
            parts.append(metadata['age_range'] + '세')
        
        if metadata.get('regions') != 'all':
            parts.append(metadata['regions'])
        
        if metadata.get('categories') != 'none':
            parts.append(metadata['categories'])
        
        if metadata.get('is_churn_target'):
            parts.append('이탈고객')
        
        return ', '.join(parts) if parts else '전체 고객'
    
    def clear(self):
        """저장소 초기화"""
        if not self.is_available:
            return
        
        self._ensure_initialized()
        
        # 컬렉션 삭제 후 재생성
        self._client.delete_collection("campaigns")
        self._collection = self._client.create_collection(
            name="campaigns",
            metadata={"description": "TargetUP AI 캠페인 문안 저장소"}
        )


# 싱글톤 인스턴스
rag_store = RAGStore()


def add_campaign_to_rag(campaign: Campaign, spec: FilterSpec):
    """
    캠페인을 RAG 저장소에 추가하는 편의 함수
    """
    if campaign.id and campaign.sms_text:
        rag_store.add_campaign(
            campaign_id=campaign.id,
            prompt=campaign.user_prompt,
            spec=spec,
            sms_text=campaign.sms_text,
            lms_text=campaign.lms_text or "",
            total_count=campaign.total_count
        )


def search_similar_campaigns(prompt: str, spec: FilterSpec) -> List[Dict]:
    """
    유사 캠페인 검색 편의 함수
    """
    return rag_store.search_similar(prompt, spec)
