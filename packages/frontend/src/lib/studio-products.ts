/**
 * studio-products.ts — 이미지 스튜디오 제품 사진 칸 준비(★ 2026-11-02 · 최대 3장)
 *
 * 담은 칸마다 차례로 원본 저장(업로드 · 몰 이미지) → 누끼 → 미리보기. 칸 수명 = 설계서
 * docs/2026-11-02-image-studio-multi-product-design.md §2 「칸 수명 표」 그대로.
 * 네트워크 · 상태 변경은 부르는 쪽(useStudioMake)이 넘긴다 — 순수 함수라 백엔드 vitest 가 동작을 그대로 시험한다
 * (image-studio-multi-product-1102.test.ts · 프론트에 테스트 러너가 없다).
 */

export interface ProductPrepItem { key: string; file?: File; imageUrl: string | null }

export interface ProductPrepDeps {
  /** 이 묶음의 세대가 아직 살아 있나(처음으로 · 언마운트면 false) */
  live: () => boolean;
  setBusy: (msg: string) => void;
  /** 원본 저장 → 원본 임시 id(실패 = 사람에게 보일 문장으로 던진다) */
  upload: (file: File) => Promise<string>;
  ingest: (imageUrl: string) => Promise<string>;
  /** 누끼 → 누끼 임시 id */
  removeBg: (sourceTempId: string) => Promise<string>;
  /** 누끼 미리보기 주소(blob) */
  preview: (cutoutTempId: string) => Promise<string>;
  revoke: (url: string) => void;
  onCutout: (key: string, cutoutTempId: string) => void;
  onPreview: (key: string, url: string) => void;
  /** 원본 저장 · 누끼 실패 = 그 칸을 뺀다 */
  onFail: (key: string, message: string) => void;
}

/**
 * 준비 묶음 하나. 지난 세대가 되면 그 자리에서 null(표시 · 칸을 건드리지 않는다).
 * 준비 표시는 묶음 시작에 켜고 묶음 끝에만 끈다(두 화면 모두 이 표시로 만들기를 막는다 = 준비 중 생성 0).
 */
export async function runProductPrep(added: ProductPrepItem[], d: ProductPrepDeps): Promise<{ ready: number } | null> {
  let ready = 0;
  for (const [n, a] of added.entries()) {
    // 반복 입구 = 다음 사진으로 넘어가는 모든 길의 관문(미리보기 실패 뒤 포함 · Codex 구현 1R)
    if (!d.live()) return null;
    const step = added.length > 1 ? ` (${n + 1}/${added.length})` : '';
    d.setBusy(`상품 이미지 준비 중...${step}`);
    let cutoutTempId: string;
    try {
      const sourceTempId = a.file ? await d.upload(a.file) : a.imageUrl ? await d.ingest(a.imageUrl) : null;
      if (!sourceTempId) throw new Error('상품 이미지가 없습니다');
      if (!d.live()) return null;
      d.setBusy(`제품 누끼 따는 중... (배경 자동 제거)${step}`);
      cutoutTempId = await d.removeBg(sourceTempId);
      if (!d.live()) return null;
    } catch (e: any) {
      // 원본 저장 · 누끼 실패 = 그 칸만 뺀다 · 다음 칸은 계속
      if (!d.live()) return null;
      d.onFail(a.key, e?.message || '상품 준비에 실패했어요');
      continue;
    }
    // 누끼 ID 는 미리보기보다 먼저 남긴다(미리보기를 못 받아도 상품은 포스터에 들어간다 · Codex 1031 ① · 설계 1R ③)
    d.onCutout(a.key, cutoutTempId);
    ready += 1;
    try {
      const url = await d.preview(cutoutTempId);
      if (!d.live()) { d.revoke(url); return null; }
      d.onPreview(a.key, url);
    } catch { /* 미리보기만 못 띄운다 · 칸 · 누끼 ID 는 그대로(「미리보기 없음」) */ }
  }
  if (!d.live()) return null;
  d.setBusy('');
  return { ready };
}
