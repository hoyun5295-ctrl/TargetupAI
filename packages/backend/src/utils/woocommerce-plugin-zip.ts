/**
 * woocommerce-plugin-zip.ts — 한줄로 우커머스 플러그인 zip 조립 (2026-09-14 ② 플러그인)
 *
 * 실물 = backend/wp-plugin/hanjullo-woocommerce/** (커밋 소스 · git pull 이면 항상 존재 · sdk-serving 과 같은 위치 규약).
 * 요청 시 저장 zip 으로 묶어 준다(비밀값 0 · 텍스트 몇 개 · 결정적 mtime 으로 캐시 가능).
 * 워드프레스 "플러그인 업로드"는 zip 최상위에 폴더 하나(hanjullo-woocommerce/)가 있어야 그 이름으로 설치된다.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';
import { buildStoredZip, type ZipEntry } from './zip-store';

export const WOO_PLUGIN_SLUG = 'hanjullo-woocommerce';
export const WOO_PLUGIN_ZIP_NAME = `${WOO_PLUGIN_SLUG}.zip`;

// src/utils · dist/utils 어디서든 2단계 위 = backend 루트 → wp-plugin (dist 스왑과 무관한 위치)
const PLUGIN_DIR = resolve(__dirname, '../../wp-plugin', WOO_PLUGIN_SLUG);
const ALLOWED_EXT = new Set(['.php', '.txt', '.js', '.css', '.md', '.pot', '.json']);

let cache: { key: string; zip: Buffer } | null = null;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (ALLOWED_EXT.has(name.slice(name.lastIndexOf('.')).toLowerCase())) out.push(p);
  }
}

/** 플러그인 폴더 → zip. 파일 목록·수정 시각이 같으면 캐시를 돌려준다. */
export function buildWooPluginZip(dir: string = PLUGIN_DIR): Buffer {
  const files: string[] = [];
  walk(dir, files);
  files.sort();
  if (!files.length) throw new Error(`플러그인 소스가 없습니다: ${dir}`);
  const key = files.map((f) => `${relative(dir, f)}:${statSync(f).mtimeMs}`).join('|');
  if (cache && cache.key === key) return cache.zip;
  const entries: ZipEntry[] = files.map((f) => ({
    name: `${WOO_PLUGIN_SLUG}/${relative(dir, f).split('\\').join('/')}`,
    data: readFileSync(f),
    mtime: statSync(f).mtime,
  }));
  const zip = buildStoredZip(entries);
  cache = { key, zip };
  return zip;
}
