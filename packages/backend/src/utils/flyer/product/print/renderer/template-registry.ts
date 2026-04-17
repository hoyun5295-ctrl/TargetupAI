/**
 * ★ 인쇄전단 V2 (D129) — 템플릿 레지스트리
 *
 * 역할: templates/<id>/ 폴더에서 manifest.json + template.html + template.css를
 *       로드하고 메모리에 캐시. 슬롯 검증 포함.
 *
 * 사용:
 *   const tpl = await loadTemplate('mart_spring_v1');
 *   tpl.manifest  // 파싱된 매니페스트
 *   tpl.html      // template.html 원본
 *   tpl.css       // template.css 원본
 */

import fs from 'fs';
import path from 'path';
import { PaperSizeKey, PAPER_SIZES } from '../PAPER-SIZES';

// ============================================================
// 타입
// ============================================================

export type SlotType =
  | 'text'
  | 'rich_text'
  | 'typography'
  | 'image'
  | 'qr'
  | 'map'
  | 'product_card'
  | 'product_grid'
  | 'category_grid'
  | 'section_banner'
  | 'store_header'
  | 'footer_notice'
  | 'decoration';

export interface SlotDefinition {
  id: string;
  type: SlotType;
  required?: boolean;
  editable?: boolean;
  maxLength?: number;
  fallback?: string;
  position?: { css?: string };
  [key: string]: any;  // 타입별 추가 필드
}

export interface TemplateManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  industry: 'mart' | 'butcher' | 'fruit' | 'fish' | 'convenience' | 'general';
  season?: 'spring' | 'summer' | 'autumn' | 'winter' | 'chuseok' | 'seol' | 'general';
  paper: { size: PaperSizeKey; orientation?: 'portrait' | 'landscape' };
  pages: number;
  assets: { html: string; css: string; preview?: string };
  tokens?: string;
  slots: SlotDefinition[];
}

export interface LoadedTemplate {
  manifest: TemplateManifest;
  html: string;
  css: string;
  basePath: string;
}

// ============================================================
// 경로 해석
// ============================================================

const TEMPLATES_DIR = path.resolve(
  __dirname,
  '..',
  'templates',
);

function resolveTemplatePath(templateId: string): string {
  // 경로 traversal 방지: templateId는 영숫자/언더바만 허용
  if (!/^[a-z0-9_]+$/i.test(templateId)) {
    throw new Error(`Invalid templateId: ${templateId}`);
  }
  const dir = path.join(TEMPLATES_DIR, templateId);
  if (!fs.existsSync(dir)) {
    throw new Error(`Template not found: ${templateId} (${dir})`);
  }
  return dir;
}

// ============================================================
// 검증
// ============================================================

function validateManifest(m: any, templateId: string): asserts m is TemplateManifest {
  if (!m || typeof m !== 'object') throw new Error(`[${templateId}] manifest is not an object`);
  if (m.id !== templateId) throw new Error(`[${templateId}] manifest.id mismatch: ${m.id}`);
  if (!m.version) throw new Error(`[${templateId}] missing version`);
  if (!m.paper || !m.paper.size) throw new Error(`[${templateId}] missing paper.size`);
  if (!PAPER_SIZES[m.paper.size as PaperSizeKey]) {
    throw new Error(`[${templateId}] invalid paper.size: ${m.paper.size}`);
  }
  if (!Array.isArray(m.slots)) throw new Error(`[${templateId}] slots must be array`);

  // 슬롯 ID 중복 검사
  const seen = new Set<string>();
  for (const s of m.slots) {
    if (!s.id) throw new Error(`[${templateId}] slot missing id`);
    if (!s.type) throw new Error(`[${templateId}] slot ${s.id} missing type`);
    if (seen.has(s.id)) throw new Error(`[${templateId}] duplicate slot id: ${s.id}`);
    seen.add(s.id);
  }
}

// ============================================================
// 캐시 (메모리, 프로세스 생존기간)
// ============================================================

const cache = new Map<string, LoadedTemplate>();

// ============================================================
// Public API
// ============================================================

/**
 * 템플릿 로드 (캐시 사용)
 */
export async function loadTemplate(templateId: string, opts?: { nocache?: boolean }): Promise<LoadedTemplate> {
  if (!opts?.nocache && cache.has(templateId)) {
    return cache.get(templateId)!;
  }

  const basePath = resolveTemplatePath(templateId);

  // manifest
  const manifestPath = path.join(basePath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found for ${templateId}`);
  }
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  let manifest: any;
  try {
    manifest = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`[${templateId}] manifest.json parse error: ${e.message}`);
  }
  validateManifest(manifest, templateId);

  // html
  const htmlPath = path.join(basePath, manifest.assets.html || 'template.html');
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`template.html not found: ${htmlPath}`);
  }
  const html = fs.readFileSync(htmlPath, 'utf-8');

  // css
  const cssPath = path.join(basePath, manifest.assets.css || 'template.css');
  if (!fs.existsSync(cssPath)) {
    throw new Error(`template.css not found: ${cssPath}`);
  }
  const css = fs.readFileSync(cssPath, 'utf-8');

  const loaded: LoadedTemplate = { manifest, html, css, basePath };
  cache.set(templateId, loaded);
  return loaded;
}

/**
 * 캐시 클리어 (개발 중 핫 리로드용)
 */
export function clearTemplateCache(templateId?: string): void {
  if (templateId) cache.delete(templateId);
  else cache.clear();
}

/**
 * 사용 가능한 템플릿 목록 조회
 */
export function listTemplates(): Array<{ id: string; name: string; industry: string; season?: string; paper: string }> {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  const dirs = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const list: Array<any> = [];
  for (const id of dirs) {
    const mPath = path.join(TEMPLATES_DIR, id, 'manifest.json');
    if (!fs.existsSync(mPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(mPath, 'utf-8')) as TemplateManifest;
      list.push({
        id: m.id,
        name: m.name,
        industry: m.industry,
        season: m.season,
        paper: `${m.paper.size}${m.paper.orientation === 'landscape' ? '-L' : ''}`,
      });
    } catch {
      // skip invalid
    }
  }
  return list;
}

/**
 * 슬롯 조회 헬퍼
 */
export function getSlot(manifest: TemplateManifest, slotId: string): SlotDefinition | undefined {
  return manifest.slots.find(s => s.id === slotId);
}
