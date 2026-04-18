/**
 * Excel/CSV 파일 커넥터
 * DB 없는 고객사 대응 — IDbConnector 인터페이스 구현
 *
 * 설치 필요: npm install xlsx papaparse @types/papaparse
 *
 * 증분 동기화 전략:
 * - 파일에는 updated_at 개념이 없음
 * - 전체 행 해시 비교 방식: 이전 캐시와 비교하여 변경/추가된 행만 반환
 * - 비교 키: phone 컬럼 또는 첫 3개 컬럼 조합
 *
 * 파일 감시 모드:
 * - fs.watch로 파일 변경 감지
 * - 2초 디바운스 + 파일 해시 비교 (중복 이벤트 방지)
 * - onFileChange 콜백으로 Scheduler에 동기화 트리거
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IDbConnector, DbConnectionConfig, RawRow, ColumnInfo } from './types';
import { getLogger } from '../logger';

const logger = getLogger('db:file');

type FileChangeCallback = (filePath: string) => void;

export class ExcelCsvConnector implements IDbConnector {
  readonly dbType: 'excel' | 'csv';
  private config: DbConnectionConfig;
  private xlsx: any = null;
  private Papa: any = null;
  private connected = false;
  private watcher: fs.FSWatcher | null = null;
  private onChangeCallback: FileChangeCallback | null = null;
  private lastFileHash: string | null = null;

  // 증분 비교용 캐시 (키 → 행 해시)
  private previousRowHashes: Map<string, string> = new Map();

  constructor(config: DbConnectionConfig) {
    this.config = config;
    this.dbType = config.type as 'excel' | 'csv';
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const filePath = this.getFilePath();
    if (!fs.existsSync(filePath)) {
      throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
    }

    // 라이브러리 동적 로드
    if (this.dbType === 'excel') {
      try {
        this.xlsx = require('xlsx');
      } catch {
        throw new Error('xlsx 패키지가 설치되지 않았습니다. npm install xlsx');
      }
    } else {
      try {
        this.Papa = require('papaparse');
      } catch {
        throw new Error('papaparse 패키지가 설치되지 않았습니다. npm install papaparse');
      }
    }

    this.connected = true;
    logger.info(`파일 커넥터 연결: ${filePath} (${this.dbType})`);

    // 감시 모드
    if (this.config.watchMode) {
      this.startWatching();
    }
  }

  async disconnect(): Promise<void> {
    this.stopWatching();
    this.previousRowHashes.clear();
    this.connected = false;
    logger.info('파일 커넥터 종료');
  }

  isConnected(): boolean {
    return this.connected;
  }

  async testConnection(): Promise<boolean> {
    try {
      const filePath = this.getFilePath();
      if (!fs.existsSync(filePath)) return false;
      await this.connect();
      const rows = this.readFile();
      return rows.length >= 0;
    } catch {
      return false;
    }
  }

  async getTables(): Promise<string[]> {
    this.ensureConnected();
    if (this.dbType === 'excel' && this.xlsx) {
      const workbook = this.xlsx.readFile(this.getFilePath());
      return workbook.SheetNames;
    }
    // CSV는 파일명이 테이블명
    return [path.basename(this.getFilePath(), path.extname(this.getFilePath()))];
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();
    const rows = this.readFile(tableName);
    if (rows.length === 0) return [];

    return Object.keys(rows[0]).map((name) => ({
      name,
      dataType: this.inferType(rows[0][name]),
      nullable: true,
    }));
  }

  async fetchAll(
    tableName: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    this.ensureConnected();
    const allRows = this.readFile(tableName);

    // 페이지네이션
    const sliced = allRows.slice(offset, offset + limit);

    // 캐시 업데이트 (전체 데이터 기준)
    if (offset === 0) {
      this.cacheRows(allRows);
    }

    logger.debug(`파일 fetchAll: ${sliced.length}건`, { tableName, offset });
    return sliced;
  }

  async fetchIncremental(
    tableName: string,
    _timestampColumn: string,
    _since: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    this.ensureConnected();

    // 첫 호출 시 (캐시 없음) → 빈 배열 반환 (전체 동기화가 먼저 실행됨)
    if (this.previousRowHashes.size === 0) {
      logger.debug('파일 증분: 캐시 없음 — 빈 결과 반환');
      return [];
    }

    const allRows = this.readFile(tableName);
    const changed = this.detectChanges(allRows);

    // 캐시 업데이트
    this.cacheRows(allRows);

    // 페이지네이션
    const sliced = changed.slice(offset, offset + limit);
    logger.debug(`파일 fetchIncremental: ${sliced.length}건 변경`, { tableName });
    return sliced;
  }

  async getRowCount(tableName: string): Promise<number> {
    this.ensureConnected();
    return this.readFile(tableName).length;
  }

  // ─── 파일 감시 ────────────────────────────────────────

  /**
   * 파일 변경 콜백 등록 (Scheduler에서 사용)
   */
  onFileChange(callback: FileChangeCallback): void {
    this.onChangeCallback = callback;
  }

  private startWatching(): void {
    if (this.watcher) return;

    const filePath = this.getFilePath();
    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);

    let debounceTimer: NodeJS.Timeout | null = null;

    this.watcher = fs.watch(dir, (eventType, changedFile) => {
      if (changedFile !== fileName || eventType !== 'change') return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const newHash = this.computeFileHash();
        if (newHash !== this.lastFileHash) {
          this.lastFileHash = newHash;
          logger.info(`파일 변경 감지: ${filePath}`);
          this.onChangeCallback?.(filePath);
        }
      }, 2000);
    });

    this.lastFileHash = this.computeFileHash();
    logger.info(`파일 감시 시작: ${filePath}`);
  }

  private stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('파일 감시 중단');
    }
  }

  // ─── 파일 읽기 ────────────────────────────────────────

  private readFile(sheetName?: string): RawRow[] {
    const filePath = this.getFilePath();

    if (this.dbType === 'excel') {
      return this.readExcel(filePath, sheetName);
    } else {
      return this.readCsv(filePath);
    }
  }

  private readExcel(filePath: string, sheetName?: string): RawRow[] {
    const workbook = this.xlsx.readFile(filePath);
    const target = sheetName || this.config.sheetName || workbook.SheetNames[0];
    const worksheet = workbook.Sheets[target];

    if (!worksheet) {
      logger.warn(`시트를 찾을 수 없습니다: ${target}`);
      return [];
    }

    return this.xlsx.utils.sheet_to_json(worksheet, {
      defval: null,
      raw: false,
    });
  }

  private readCsv(filePath: string): RawRow[] {
    const encoding = (this.config.encoding || 'utf-8') as BufferEncoding;
    let content = fs.readFileSync(filePath, encoding);

    // BOM 처리
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }

    const result = this.Papa.parse(content, {
      header: true,
      delimiter: this.config.delimiter || ',',
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (h: string) => h.trim(),
    });

    if (result.errors.length > 0) {
      logger.warn(`CSV 파싱 경고: ${result.errors.length}건`);
    }

    return result.data;
  }

  // ─── 변경 감지 ────────────────────────────────────────

  private cacheRows(rows: RawRow[]): void {
    this.previousRowHashes.clear();
    for (const row of rows) {
      const key = this.getRowKey(row);
      this.previousRowHashes.set(key, this.hashRow(row));
    }
  }

  private detectChanges(currentRows: RawRow[]): RawRow[] {
    const changed: RawRow[] = [];

    for (const row of currentRows) {
      const key = this.getRowKey(row);
      const prevHash = this.previousRowHashes.get(key);
      const currHash = this.hashRow(row);

      if (!prevHash || prevHash !== currHash) {
        changed.push(row);
      }
    }

    return changed;
  }

  /**
   * 행의 고유 키 — phone 컬럼 우선, 없으면 첫 3개 컬럼 조합
   */
  private getRowKey(row: RawRow): string {
    const phoneKeys = ['phone', 'PHONE', 'HP', 'TEL', 'CUST_HP', '전화번호', '휴대폰', 'customer_phone'];
    for (const pk of phoneKeys) {
      if (row[pk]) return String(row[pk]).replace(/[^0-9]/g, '');
    }
    const keys = Object.keys(row).slice(0, 3);
    return keys.map((k) => String(row[k] ?? '')).join('|');
  }

  private hashRow(row: RawRow): string {
    const content = JSON.stringify(row, Object.keys(row).sort());
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private computeFileHash(): string {
    const data = fs.readFileSync(this.getFilePath());
    return crypto.createHash('md5').update(data).digest('hex');
  }

  // ─── 유틸 ─────────────────────────────────────────────

  private getFilePath(): string {
    return this.config.filePath || this.config.database;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('파일 커넥터가 연결되지 않았습니다. connect()를 먼저 호출하세요.');
    }
  }

  private inferType(value: unknown): string {
    if (value === null || value === undefined) return 'varchar';
    if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'decimal';
    if (typeof value === 'boolean') return 'bit';
    if (typeof value === 'string' && /^\d{4}[-./]\d{2}[-./]\d{2}/.test(value)) return 'date';
    return 'varchar';
  }
}
