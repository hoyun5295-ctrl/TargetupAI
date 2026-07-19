/**
 * lib/asset-to-file.ts — 에셋 라이브러리 소재(URL) → File 변환 (2026-07-19 P4)
 *
 * File[] 기반 업로드 모달(이미지로 문안 생성·행사 판독·DM 생성 첨부)이 라이브러리 소재를
 * 직접 업로드와 동일하게 다루도록, 소재 URL을 fetch해 File로 감싼다(같은 오리진 공개 서빙).
 */

export async function assetToFile(url: string, filename?: string | null): Promise<File | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    const ext = type.split('/')[1] || 'jpg';
    const name = (filename && filename.trim()) || `library_${Date.now()}.${ext}`;
    return new File([blob], name, { type });
  } catch {
    return null;
  }
}

/** 다중 변환 — 실패 항목은 조용히 제외. */
export async function assetsToFiles(assets: Array<{ url: string; filename?: string | null }>): Promise<File[]> {
  const results = await Promise.all(assets.map((a) => assetToFile(a.url, a.filename)));
  return results.filter((f): f is File => !!f);
}
