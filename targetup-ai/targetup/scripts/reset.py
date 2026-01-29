#!/usr/bin/env python3
"""
TargetUP AI - Reset Script
데이터 및 DB 초기화
"""
import os
import sys
import shutil
import argparse
from pathlib import Path

# 경로 설정
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = PROJECT_DIR / "data"

sys.path.insert(0, str(PROJECT_DIR))


def reset_data():
    """데이터 파일 삭제 (재생성 필요)"""
    data_files = [
        DATA_DIR / "customers.parquet",
        DATA_DIR / "purchases.parquet",
        DATA_DIR / "customer_stats.parquet",
        DATA_DIR / "customer_categories.parquet",
    ]
    
    for f in data_files:
        if f.exists():
            os.remove(f)
            print(f"삭제됨: {f}")
    
    print("데이터 파일 초기화 완료. 다음 실행 시 재생성됩니다.")


def reset_db():
    """SQLite DB 삭제"""
    db_path = DATA_DIR / "campaigns.db"
    if db_path.exists():
        os.remove(db_path)
        print(f"삭제됨: {db_path}")
    
    # 타겟 CSV 폴더
    targets_dir = DATA_DIR / "targets"
    if targets_dir.exists():
        shutil.rmtree(targets_dir)
        print(f"삭제됨: {targets_dir}")
    
    print("DB 초기화 완료.")


def reset_all():
    """전체 초기화"""
    if DATA_DIR.exists():
        shutil.rmtree(DATA_DIR)
        print(f"삭제됨: {DATA_DIR}")
    
    print("전체 초기화 완료.")


def regenerate_data():
    """데이터 강제 재생성"""
    from core.data_store import load_or_generate_data
    
    print("데이터 재생성을 시작합니다...")
    load_or_generate_data(force_regenerate=True)
    print("데이터 재생성 완료!")


def main():
    parser = argparse.ArgumentParser(description="TargetUP AI 리셋 스크립트")
    parser.add_argument('--data', action='store_true', help='데이터 파일만 삭제')
    parser.add_argument('--db', action='store_true', help='DB만 삭제')
    parser.add_argument('--all', action='store_true', help='전체 삭제 (data 폴더)')
    parser.add_argument('--regenerate', action='store_true', help='데이터 강제 재생성')
    
    args = parser.parse_args()
    
    if args.all:
        confirm = input("전체 데이터를 삭제하시겠습니까? (y/N): ")
        if confirm.lower() == 'y':
            reset_all()
    elif args.data:
        reset_data()
    elif args.db:
        reset_db()
    elif args.regenerate:
        regenerate_data()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
