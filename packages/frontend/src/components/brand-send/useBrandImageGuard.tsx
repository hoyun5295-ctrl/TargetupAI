/**
 * useBrandImageGuard — 브랜드메시지 이미지 자리의 공용 입구 (★ 2026-09-20 신설)
 *
 * 라이브러리에서 고르든 파일을 올리든 **이 훅 하나를 지나야** 자리에 담긴다.
 *   1) 실제 크기·용량·형식을 잰다  2) 규격(brandImageSpec)과 대조한다
 *   3) 맞으면 담고, 어긋나면 경고 창을 띄운다 — 「규격에 맞게 자동 맞춤」 · 「다른 이미지 선택」
 * 본문 이미지 패널(BrandMessageEditor)과 자리형 입력(BrandImageSlot)이 같이 쓴다.
 * 입구가 둘이면 한쪽만 검사받는다 — 업로드 호출도 여기 한 곳에만 둔다.
 *
 * ⛔ 조용히 자르지 않는다. 맞춤은 고객이 버튼을 눌렀을 때만 하고, 원본은 라이브러리에 그대로 남는다.
 * ⛔ AI로 만든 이미지는 자동 맞춤을 쓰지 않는다 — 맞춘 결과는 「직접 업로드」로 등재되어
 *    AI 생성 이미지 안내 문구 규칙(발송 시 자동 부착)이 빠진 채 나가게 된다.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Crop, Loader2, X } from 'lucide-react';
import type { PickedAsset } from '../assets/AssetLibraryPickerModal';
import type { SlotImage } from './brandRich';
import {
  brandImageSpecLines, formatBytes, judgeBrandImage, measureImage, mimeFromName, planBrandImageFit,
  ratioLabel, renderBrandImageFit,
  type BrandImageSlotKind, type BrandImageViolation,
} from './brandImageSpec';

const toAbsoluteUrl = (u: string): string => {
  try { return new URL(u, window.location.origin).toString(); } catch { return u; }
};

/** 우리 자산 저장소에 올린다 — 카카오 등록은 발송 직전 서버가 한다(brand-image-resolver) */
async function uploadBrandAsset(file: File): Promise<{ url: string; assetId: string; name: string }> {
  const fd = new FormData();
  fd.append('image', file);
  const res = await fetch('/api/assets/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) throw new Error(String(data?.error || '업로드하지 못했습니다.'));
  return { url: toAbsoluteUrl(String(data.url || '')), assetId: String(data.assetId || ''), name: String(data.filename || file.name) };
}

interface PendingImage {
  /** 크기를 잰 이미지 요소 — 자동 맞춤이 그대로 그린다 */
  el: HTMLImageElement;
  width: number; height: number; bytes: number; mime: string; name: string;
  violations: BrandImageViolation[];
  generated: boolean;
  /** object URL이면 창을 닫을 때 풀어 준다 */
  objectUrl?: string;
}

interface GuardOptions {
  kind: BrandImageSlotKind;
  /** 자리 이름 — 경고 창 제목 아래에 쓴다 (예: "카드 이미지") */
  label: string;
  /** 같은 비율이어야 하는 기준(가로÷세로). 캐러셀의 첫 이미지 */
  matchRatio?: number | null;
  /** 이 자리는 AI로 만든 이미지를 받지 않는다 */
  blockGenerated?: boolean;
  onAccept: (img: SlotImage) => void;
  /** 「다른 이미지 선택」 — 호출부가 라이브러리 창을 다시 연다 */
  onPickAnother: () => void;
}

export function useBrandImageGuard(opts: GuardOptions) {
  const { kind, label, matchRatio, blockGenerated, onAccept, onPickAnother } = opts;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingImage | null>(null);
  const [fitting, setFitting] = useState(false);
  /** 진행 중에 다른 이미지를 고르면 늦게 온 응답을 버린다 */
  const seqRef = useRef(0);

  const closePending = () => {
    setPending((p) => { if (p?.objectUrl) URL.revokeObjectURL(p.objectUrl); return null; });
    setFitting(false);
  };

  /** 상태를 바꾸는 통로(제거 등)가 부른다 — 진행 중 응답 무효화 */
  const reset = () => { seqRef.current++; setBusy(false); setError(''); closePending(); };

  const pickAsset = async (asset: PickedAsset) => {
    const seq = ++seqRef.current;
    setError('');
    closePending();
    if (blockGenerated && asset.kind === 'generated') {
      setBusy(false);
      setError('AI로 만든 이미지는 이 자리에 쓸 수 없습니다. 직접 올린 이미지를 골라 주세요.');
      return;
    }
    const url = toAbsoluteUrl(asset.url);
    const name = asset.filename || '라이브러리 이미지';
    setBusy(true);
    try {
      const m = await measureImage(url);
      if (seq !== seqRef.current) return;
      const facts = { width: m.width, height: m.height, bytes: Number(asset.bytes) || 0, mime: mimeFromName(asset.filename || asset.url) };
      const violations = judgeBrandImage(kind, facts, matchRatio);
      if (violations.length === 0) {
        onAccept({ url, assetId: asset.id, kind: asset.kind, name, w: m.width, h: m.height });
      } else {
        setPending({ el: m.el, ...facts, name, violations, generated: asset.kind === 'generated' });
      }
    } catch (e: any) {
      if (seq === seqRef.current) setError(e?.message || '이미지를 읽지 못했습니다.');
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  };

  const pickFile = async (file: File | null) => {
    if (!file) return;
    const seq = ++seqRef.current;
    setError('');
    closePending();
    setBusy(true);
    const objectUrl = URL.createObjectURL(file);
    let keepUrl = false;
    try {
      const m = await measureImage(objectUrl);
      if (seq !== seqRef.current) return;
      const facts = { width: m.width, height: m.height, bytes: file.size, mime: (file.type || mimeFromName(file.name)).toLowerCase() };
      const violations = judgeBrandImage(kind, facts, matchRatio);
      if (violations.length > 0) {
        keepUrl = true;
        setPending({ el: m.el, ...facts, name: file.name, violations, generated: false, objectUrl });
        return;
      }
      const up = await uploadBrandAsset(file);
      if (seq !== seqRef.current) return;
      onAccept({ url: up.url, assetId: up.assetId, kind: 'uploaded', name: up.name, w: m.width, h: m.height });
    } catch (e: any) {
      if (seq === seqRef.current) setError(e?.message || '업로드하지 못했습니다.');
    } finally {
      if (!keepUrl) URL.revokeObjectURL(objectUrl);
      if (seq === seqRef.current) setBusy(false);
    }
  };

  const plan = pending && !pending.generated ? planBrandImageFit(kind, pending.width, pending.height, matchRatio) : null;

  const applyFit = async () => {
    if (!pending || !plan) return;
    const seq = ++seqRef.current;
    setFitting(true);
    try {
      const file = await renderBrandImageFit(pending.el, plan, pending.name, pending.mime);
      const up = await uploadBrandAsset(file);
      if (seq !== seqRef.current) return;
      onAccept({ url: up.url, assetId: up.assetId, kind: 'uploaded', name: up.name, w: plan.outW, h: plan.outH });
      closePending();
    } catch (e: any) {
      if (seq !== seqRef.current) return;
      setError(e?.message || '이미지를 맞추지 못했습니다.');
      closePending();
    }
  };

  const modal: ReactNode = pending ? (
    <BrandImageSpecModal
      label={label} kind={kind} matchRatio={matchRatio} pending={pending} fitting={fitting}
      fitText={plan ? `가운데를 기준으로 잘라 ${plan.outW}×${plan.outH}으로 맞춥니다. 원본은 그대로 남습니다.` : ''}
      noFitReason={plan ? '' : pending.generated
        ? 'AI로 만든 이미지는 자동 맞춤을 쓸 수 없습니다. 규격에 맞는 이미지를 선택해 주세요.'
        : '이미지가 작아 자동으로 맞출 수 없습니다. 더 큰 이미지를 선택해 주세요.'}
      onFit={applyFit}
      onAnother={() => { closePending(); onPickAnother(); }}
      onClose={closePending}
    />
  ) : null;

  return { pickAsset, pickFile, busy: busy || fitting, error, setError, reset, modal };
}

function BrandImageSpecModal({ label, kind, matchRatio, pending, fitting, fitText, noFitReason, onFit, onAnother, onClose }: {
  label: string; kind: BrandImageSlotKind; matchRatio?: number | null; pending: PendingImage; fitting: boolean;
  fitText: string; noFitReason: string; onFit: () => void; onAnother: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();   // 뒤의 발송 창까지 닫히지 않게 캡처 단계에서 먼저 잡는다
      if (!fitting) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fitting, onClose]);

  const bad = new Set(pending.violations.map((v) => v.key));
  const now: { key: BrandImageViolation['key']; label: string; value: string }[] = [
    { key: 'format', label: '형식', value: pending.mime ? pending.mime.replace('image/', '').replace('jpeg', 'jpg') : '확인 불가' },
    { key: 'bytes', label: '용량', value: pending.bytes > 0 ? formatBytes(pending.bytes) : '확인 불가' },
    { key: 'width', label: '크기', value: `${pending.width}×${pending.height}px` },
    { key: 'ratio', label: '비율', value: ratioLabel(pending.width / pending.height) },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[2200] bg-slate-900/40 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="이미지 규격 안내"
        className="w-full max-w-[440px] max-h-[88vh] overflow-y-auto bg-white rounded-2xl ring-1 ring-slate-900/5 shadow-[0_40px_90px_-20px_rgba(15,23,42,0.55)]">
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="shrink-0 mt-0.5 grid place-items-center w-7 h-7 rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-200/70">
              <AlertTriangle size={15} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-slate-900 tracking-tight">규격에 맞는 이미지를 업로드해 주세요</h2>
              <p className="text-[12px] text-slate-500 mt-0.5 truncate">{label} · {pending.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={fitting} aria-label="닫기"
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition disabled:opacity-40">
            <X size={15} strokeWidth={1.9} />
          </button>
        </div>

        <div className="px-5 pt-3.5 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-900/5 p-3">
            <div className="text-[11.5px] font-semibold text-slate-500 mb-1.5">이 자리의 규격</div>
            <dl className="space-y-1">
              {brandImageSpecLines(kind, matchRatio).map((l) => (
                <div key={l.label} className="flex gap-2 text-[12.5px]">
                  <dt className="shrink-0 w-8 text-slate-400">{l.label}</dt>
                  <dd className="min-w-0 text-slate-700">{l.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
            <div className="text-[11.5px] font-semibold text-slate-500 mb-1.5">지금 이미지</div>
            <dl className="space-y-1">
              {now.map((l) => (
                <div key={l.key} className="flex gap-2 text-[12.5px]">
                  <dt className="shrink-0 w-8 text-slate-400">{l.label}</dt>
                  <dd className={`min-w-0 tabular-nums ${bad.has(l.key) ? 'text-rose-600 font-semibold' : 'text-slate-700'}`}>{l.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <ul className="px-5 pt-3 space-y-1">
          {pending.violations.map((v) => (
            <li key={v.key} className="text-[12.5px] text-rose-600 leading-relaxed">· {v.text}</li>
          ))}
        </ul>

        <p className="px-5 pt-2.5 text-[12px] text-slate-500 leading-relaxed">{fitText || noFitReason}</p>

        <div className="flex flex-wrap justify-end gap-2 px-5 pt-3.5 pb-4">
          <button type="button" onClick={onAnother} disabled={fitting}
            className="px-3.5 py-2 rounded-xl text-[13px] font-semibold text-slate-600 bg-white ring-1 ring-slate-200 hover:ring-slate-300 hover:text-slate-800 transition disabled:opacity-40">
            다른 이미지 선택
          </button>
          {fitText && (
            <button type="button" onClick={onFit} disabled={fitting}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold text-white bg-slate-900 hover:bg-slate-800 transition disabled:opacity-60">
              {fitting ? <Loader2 size={14} className="animate-spin" /> : <Crop size={14} strokeWidth={2} />}
              {fitting ? '맞추는 중' : '규격에 맞게 자동 맞춤'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
