"""
TargetUP AI - Campaign Database
SQLite 기반 캠페인/예약 영구 저장
"""
import sqlite3
import csv
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple
import json

from .models import Campaign, FilterSpec


# DB 경로
DB_DIR = Path(__file__).parent.parent / "data"
DB_PATH = DB_DIR / "campaigns.db"
TARGETS_DIR = DB_DIR / "targets"


def ensure_dirs():
    """디렉토리 생성"""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    TARGETS_DIR.mkdir(parents=True, exist_ok=True)


class CampaignDB:
    """캠페인 데이터베이스"""
    
    def __init__(self):
        ensure_dirs()
        self.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._create_tables()
    
    def _create_tables(self):
        """테이블 생성"""
        cursor = self.conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                user_prompt TEXT NOT NULL,
                send_at TEXT NOT NULL,
                as_of_date TEXT,
                spec_json TEXT,
                total_count INTEGER DEFAULT 0,
                targets_csv_path TEXT,
                selected_variant_id TEXT,
                sms_text TEXT,
                lms_text TEXT,
                status TEXT DEFAULT 'scheduled',
                sent_at TEXT
            )
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_campaigns_status 
            ON campaigns(status)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_campaigns_send_at 
            ON campaigns(send_at)
        """)
        
        self.conn.commit()
    
    def save_campaign(self, 
                      user_prompt: str,
                      send_at: datetime,
                      spec: FilterSpec,
                      total_count: int,
                      customer_ids: List[str],
                      selected_variant_id: str,
                      sms_text: str,
                      lms_text: str) -> int:
        """
        캠페인 저장
        Returns: 캠페인 ID
        """
        cursor = self.conn.cursor()
        now = datetime.now()
        
        # 타겟 CSV 저장
        csv_filename = f"targets_{now.strftime('%Y%m%d_%H%M%S')}.csv"
        csv_path = TARGETS_DIR / csv_filename
        
        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['customer_id'])
            for cid in customer_ids:
                writer.writerow([cid])
        
        # DB 저장
        cursor.execute("""
            INSERT INTO campaigns (
                created_at, user_prompt, send_at, as_of_date, spec_json,
                total_count, targets_csv_path, selected_variant_id,
                sms_text, lms_text, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            now.isoformat(),
            user_prompt,
            send_at.isoformat(),
            spec.as_of_date.isoformat() if spec.as_of_date else None,
            spec.to_json(),
            total_count,
            str(csv_path),
            selected_variant_id,
            sms_text,
            lms_text,
            'scheduled'
        ))
        
        self.conn.commit()
        return cursor.lastrowid
    
    def get_campaign(self, campaign_id: int) -> Optional[Campaign]:
        """캠페인 조회"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,))
        row = cursor.fetchone()
        
        if row:
            return self._row_to_campaign(row)
        return None
    
    def get_all_campaigns(self, 
                          status: Optional[str] = None,
                          limit: int = 100) -> List[Campaign]:
        """캠페인 목록 조회"""
        cursor = self.conn.cursor()
        
        if status:
            cursor.execute("""
                SELECT * FROM campaigns 
                WHERE status = ?
                ORDER BY send_at DESC
                LIMIT ?
            """, (status, limit))
        else:
            cursor.execute("""
                SELECT * FROM campaigns 
                ORDER BY send_at DESC
                LIMIT ?
            """, (limit,))
        
        return [self._row_to_campaign(row) for row in cursor.fetchall()]
    
    def get_due_campaigns(self) -> List[Campaign]:
        """발송 예정 캠페인 조회 (status=scheduled AND send_at <= now)"""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        
        cursor.execute("""
            SELECT * FROM campaigns 
            WHERE status = 'scheduled' AND send_at <= ?
            ORDER BY send_at ASC
        """, (now,))
        
        return [self._row_to_campaign(row) for row in cursor.fetchall()]
    
    def update_status(self, campaign_id: int, status: str, sent_at: Optional[datetime] = None):
        """캠페인 상태 업데이트"""
        cursor = self.conn.cursor()
        
        if sent_at:
            cursor.execute("""
                UPDATE campaigns 
                SET status = ?, sent_at = ?
                WHERE id = ?
            """, (status, sent_at.isoformat(), campaign_id))
        else:
            cursor.execute("""
                UPDATE campaigns 
                SET status = ?
                WHERE id = ?
            """, (status, campaign_id))
        
        self.conn.commit()
    
    def cancel_campaign(self, campaign_id: int) -> bool:
        """캠페인 취소"""
        campaign = self.get_campaign(campaign_id)
        if campaign and campaign.status == 'scheduled':
            self.update_status(campaign_id, 'canceled')
            return True
        return False
    
    def send_now(self, campaign_id: int) -> bool:
        """캠페인 즉시 발송 (시뮬레이션)"""
        campaign = self.get_campaign(campaign_id)
        if campaign and campaign.status == 'scheduled':
            self.update_status(campaign_id, 'sent', datetime.now())
            return True
        return False
    
    def delete_campaign(self, campaign_id: int) -> bool:
        """캠페인 삭제"""
        campaign = self.get_campaign(campaign_id)
        if campaign:
            # CSV 파일 삭제
            if campaign.targets_csv_path and os.path.exists(campaign.targets_csv_path):
                os.remove(campaign.targets_csv_path)
            
            cursor = self.conn.cursor()
            cursor.execute("DELETE FROM campaigns WHERE id = ?", (campaign_id,))
            self.conn.commit()
            return True
        return False
    
    def get_targets_csv(self, campaign_id: int) -> Optional[str]:
        """타겟 CSV 경로 반환"""
        campaign = self.get_campaign(campaign_id)
        if campaign and campaign.targets_csv_path:
            return campaign.targets_csv_path
        return None
    
    def get_campaign_stats(self) -> dict:
        """캠페인 통계"""
        cursor = self.conn.cursor()
        
        stats = {}
        for status in ['scheduled', 'sent', 'canceled']:
            cursor.execute(
                "SELECT COUNT(*) FROM campaigns WHERE status = ?", 
                (status,)
            )
            stats[status] = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM campaigns")
        stats['total'] = cursor.fetchone()[0]
        
        return stats
    
    def _row_to_campaign(self, row) -> Campaign:
        """Row를 Campaign 객체로 변환"""
        return Campaign(
            id=row['id'],
            created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None,
            user_prompt=row['user_prompt'],
            send_at=datetime.fromisoformat(row['send_at']) if row['send_at'] else None,
            as_of_date=datetime.fromisoformat(row['as_of_date']).date() if row['as_of_date'] else None,
            spec_json=row['spec_json'],
            total_count=row['total_count'],
            targets_csv_path=row['targets_csv_path'],
            selected_variant_id=row['selected_variant_id'],
            sms_text=row['sms_text'],
            lms_text=row['lms_text'],
            status=row['status'],
            sent_at=datetime.fromisoformat(row['sent_at']) if row['sent_at'] else None
        )
    
    def close(self):
        """연결 종료"""
        self.conn.close()


# 싱글톤 인스턴스
campaign_db = CampaignDB()
