"""
TargetUP AI - Data Models
"""
from dataclasses import dataclass, field, asdict
from datetime import datetime, date
from typing import Optional, List, Dict, Any
import json


@dataclass
class FilterSpec:
    """타겟팅 조건 스펙"""
    gender: Optional[str] = None  # 'F', 'M', None(전체)
    age_min: Optional[int] = None
    age_max: Optional[int] = None
    regions: List[str] = field(default_factory=list)
    skin_types: List[str] = field(default_factory=list)
    
    # 구매 기간 조건
    purchased_within_months: Optional[int] = None  # 최근 N개월 구매 O
    not_purchased_within_months: Optional[int] = None  # 최근 N개월 구매 X
    
    # 카테고리 조건
    categories: List[str] = field(default_factory=list)
    category_mode: str = "ANY"  # "ANY"(합집합) or "ALL"(교집합)
    
    # 파싱된 원본
    raw_prompt: str = ""
    as_of_date: Optional[date] = None
    
    def to_json(self) -> str:
        data = asdict(self)
        data['as_of_date'] = self.as_of_date.isoformat() if self.as_of_date else None
        return json.dumps(data, ensure_ascii=False, indent=2)
    
    @classmethod
    def from_json(cls, json_str: str) -> 'FilterSpec':
        data = json.loads(json_str)
        if data.get('as_of_date'):
            data['as_of_date'] = date.fromisoformat(data['as_of_date'])
        return cls(**data)


@dataclass
class MessageVariant:
    """문안 변형"""
    variant_id: str  # 'A', 'B', 'C'
    variant_name: str  # '혜택 직결', '긴급/타이밍', '웰컴백'
    sms_text: str
    lms_text: str
    sms_bytes: int = 0
    lms_bytes: int = 0
    score: float = 0.0  # 자동 추천 점수
    
    def __post_init__(self):
        self.sms_bytes = len(self.sms_text.encode('euc-kr', errors='replace'))
        self.lms_bytes = len(self.lms_text.encode('euc-kr', errors='replace'))


@dataclass
class Campaign:
    """캠페인"""
    id: Optional[int] = None
    created_at: Optional[datetime] = None
    user_prompt: str = ""
    send_at: Optional[datetime] = None
    as_of_date: Optional[date] = None
    spec_json: str = "{}"
    total_count: int = 0
    targets_csv_path: Optional[str] = None
    selected_variant_id: Optional[str] = None
    sms_text: Optional[str] = None
    lms_text: Optional[str] = None
    status: str = "scheduled"  # scheduled, sent, canceled
    sent_at: Optional[datetime] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'user_prompt': self.user_prompt,
            'send_at': self.send_at.isoformat() if self.send_at else None,
            'as_of_date': self.as_of_date.isoformat() if self.as_of_date else None,
            'spec_json': self.spec_json,
            'total_count': self.total_count,
            'targets_csv_path': self.targets_csv_path,
            'selected_variant_id': self.selected_variant_id,
            'sms_text': self.sms_text,
            'lms_text': self.lms_text,
            'status': self.status,
            'sent_at': self.sent_at.isoformat() if self.sent_at else None,
        }


# 상수 정의
STAGES = [
    '클렌징', '스킨', '에센스', '로션/크림', '눈가케어', 
    '집중케어', '헤어/바디', '메이크업', '선케어', '립케어', 
    '마스크팩', '건강케어'
]

CONCERNS = [
    '수분/보습', '미백/잡티', '트러블/진정', '주름/탄력', 
    '모공/피지', '남성', '맘/임산부'
]

CATEGORIES = STAGES + CONCERNS

REGIONS = ['서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종', 
           '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']

SKIN_TYPES = ['건성', '지성', '복합성', '민감성', '중성']

GRADES = ['VIP', 'GOLD', 'SILVER', 'BRONZE', 'NORMAL']
