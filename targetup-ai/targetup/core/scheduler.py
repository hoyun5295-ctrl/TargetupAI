"""
TargetUP AI - Scheduler
예정된 캠페인 자동 처리 (Streamlit rerun 환경 고려)
"""
from datetime import datetime
from typing import List, Tuple

from .campaign_db import campaign_db
from .models import Campaign


class CampaignScheduler:
    """캠페인 스케줄러"""
    
    def __init__(self):
        pass
    
    def process_due_campaigns(self) -> List[Tuple[Campaign, bool]]:
        """
        발송 예정 캠페인 처리 (idempotent)
        Returns: [(campaign, success), ...]
        """
        results = []
        
        # status='scheduled' AND send_at <= now() 인 건 조회
        due_campaigns = campaign_db.get_due_campaigns()
        
        for campaign in due_campaigns:
            success = self._send_campaign(campaign)
            results.append((campaign, success))
        
        return results
    
    def _send_campaign(self, campaign: Campaign) -> bool:
        """
        캠페인 발송 (시뮬레이션)
        실제 환경에서는 여기서 SMS/LMS API 호출
        """
        try:
            # 상태를 sent로 변경
            campaign_db.update_status(campaign.id, 'sent', datetime.now())
            
            # 실제 발송 로직 (시뮬레이션)
            print(f"[발송 완료] Campaign #{campaign.id}: {campaign.total_count}명에게 발송")
            
            return True
        except Exception as e:
            print(f"[발송 실패] Campaign #{campaign.id}: {e}")
            return False
    
    def get_pending_count(self) -> int:
        """대기 중인 캠페인 수"""
        campaigns = campaign_db.get_all_campaigns(status='scheduled')
        return len(campaigns)
    
    def get_today_scheduled(self) -> List[Campaign]:
        """오늘 발송 예정 캠페인"""
        today = datetime.now().date()
        all_scheduled = campaign_db.get_all_campaigns(status='scheduled')
        
        return [c for c in all_scheduled if c.send_at and c.send_at.date() == today]


# 싱글톤 인스턴스
scheduler = CampaignScheduler()
