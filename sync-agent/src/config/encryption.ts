/**
 * 설정 파일 AES-256-GCM 암호화/복호화
 * DB 접속 정보, API 키 등 민감 데이터 보호
 *
 * 변경사항 (2026-02-11):
 *   - generateKey(): 암호화 키 자동 생성
 *   - loadOrCreateKey(): data/agent.key 자동 관리
 *   - getKeyPath(): 키 파일 경로 반환
 *   - 키 파일 권한 설정 (Windows NTFS ACL은 별도)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;     // 128 bit
const TAG_LENGTH = 16;    // 128 bit
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;    // 256 bit
const ITERATIONS = 100000;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const KEY_FILE = path.join(DATA_DIR, 'agent.key');

/**
 * 패스프레이즈에서 암호화 키 파생 (PBKDF2)
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * 평문 JSON을 AES-256-GCM으로 암호화
 * @returns Base64 인코딩된 암호문 (salt + iv + tag + encrypted)
 */
export function encrypt(plaintext: string, passphrase: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // salt(32) + iv(16) + tag(16) + encrypted(...)
  const combined = Buffer.concat([salt, iv, tag, encrypted]);
  return combined.toString('base64');
}

/**
 * AES-256-GCM 암호문을 복호화
 * @param ciphertext Base64 인코딩된 암호문
 */
export function decrypt(ciphertext: string, passphrase: string): string {
  const combined = Buffer.from(ciphertext, 'base64');

  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(passphrase, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * 암호화 키 유효성 검증 (복호화 시도)
 */
export function validateKey(ciphertext: string, passphrase: string): boolean {
  try {
    decrypt(ciphertext, passphrase);
    return true;
  } catch {
    return false;
  }
}

// ─── 키 관리 ────────────────────────────────────────────

/**
 * 암호화 키(패스프레이즈) 자동 생성
 * 64자 hex 문자열 (256bit 랜덤)
 */
export function generateKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 키 파일 경로 반환
 */
export function getKeyPath(): string {
  return KEY_FILE;
}

/**
 * 키 파일이 존재하는지 확인
 */
export function hasKeyFile(): boolean {
  return fs.existsSync(KEY_FILE);
}

/**
 * 키 파일에서 암호화 키 로드
 * 파일이 없으면 null 반환
 */
export function loadKey(): string | null {
  if (!fs.existsSync(KEY_FILE)) {
    return null;
  }
  return fs.readFileSync(KEY_FILE, 'utf8').trim();
}

/**
 * 키를 파일에 저장
 * data/ 디렉토리 자동 생성
 */
export function saveKey(key: string): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(KEY_FILE, key, { encoding: 'utf8', mode: 0o600 });
}

/**
 * 키 파일 로드 — 없으면 자동 생성
 * 설치 마법사/Agent 시작 시 호출
 */
export function loadOrCreateKey(): string {
  const existing = loadKey();
  if (existing) {
    return existing;
  }

  const newKey = generateKey();
  saveKey(newKey);
  return newKey;
}

/**
 * 평문 config.json이 있으면 암호화 버전으로 마이그레이션
 * config.json → config.enc 변환 후 config.json 삭제
 *
 * @returns 마이그레이션 수행 여부
 */
export function migrateJsonToEncrypted(): boolean {
  const jsonPath = path.join(DATA_DIR, 'config.json');
  const encPath = path.join(DATA_DIR, 'config.enc');

  // config.json이 없거나 이미 enc가 있으면 스킵
  if (!fs.existsSync(jsonPath) || fs.existsSync(encPath)) {
    return false;
  }

  const key = loadOrCreateKey();
  const plaintext = fs.readFileSync(jsonPath, 'utf8');

  // JSON 파싱 테스트 (유효한 JSON인지 확인)
  try {
    JSON.parse(plaintext);
  } catch {
    return false;
  }

  // 암호화 저장
  const ciphertext = encrypt(plaintext, key);
  fs.writeFileSync(encPath, ciphertext, 'utf8');

  // 원본 삭제
  fs.unlinkSync(jsonPath);

  return true;
}
