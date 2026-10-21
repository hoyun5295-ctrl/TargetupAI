/**
 * make-entry.ts — 만들기 화면 「그 밖에」 → 모바일 DM · 이메일 화면 진입 약속 한 곳(★ 2026-10-20 임은지 접수 cmvewqxm21)
 *
 * 옛: 보내는 쪽(QuickCampaignPage `otherTo`)과 받는 쪽(DmBuilderPage · EmailCampaignsPage)이 `?other=` 글자를 따로 정했다.
 *   [한 줄로 자동 생성] · [이미지로 불러오기 · 저장 소재에서] 둘 다 `?other=1` 이었고, 9/30 AI 존 개편이 받는 쪽의 `1` 처리
 *   (접힌 「다른 방법」 패널 펼침)를 지워 두 버튼이 모바일 DM 첫 화면에 멈췄다. 10/17 에는 도착 화면 버튼 이름도 바뀌었다.
 * 지금: 버튼 목록 · 라벨 · 주소 · 읽기를 여기 한 곳이 소유한다. 받는 쪽은 종류마다 실제 동작을 하고(switch + never = 빠지면 tsc 오류),
 *   없는 입구는 감춘다(이메일 화면에는 질문 몇 개로 · 완성 이미지 입구가 없다).
 * ⛔ 크레딧이 드는 길로 돌리지 않는다 — 완성 이미지 = 모바일 DM 화면의 0크레딧 카탈로그 DM(만들기 카탈로그 = 10크레딧 AI 제작과 다르다).
 */
import type { BuildChannel } from './ai-build';

export type MakeOtherKind = 'line' | 'onestep' | 'images' | 'library' | 'blocks';
/** 모바일 DM 화면이 받는 진입 = 다섯 가지 모두 */
export type DmEntryKind = MakeOtherKind;
/** 이메일 화면이 받는 진입 */
export type EmailEntryKind = Extract<MakeOtherKind, 'line' | 'library' | 'blocks'>;

export interface MakeOtherItem { kind: MakeOtherKind; label: string }

// ★ 2026-10-21 「질문 몇 개로」 = 한 줄 창으로 흡수(입구 하나 · 설계서 docs/2026-10-21-oneline-content-design.md §3-1) · 옛 주소 onestep 은 읽을 때 line
const DM_ENTRY: readonly DmEntryKind[] = ['line', 'images', 'library', 'blocks'];
const EMAIL_ENTRY: readonly EmailEntryKind[] = ['line', 'library', 'blocks'];

const LABEL: Record<MakeOtherKind, string> = {
  line: '한 줄로 자동 생성',
  onestep: '질문 몇 개로 만들기',
  images: '완성 이미지로',
  library: '저장 소재에서',
  blocks: '블록으로 직접 만들기',
};

/** 만들기 「그 밖에」 줄에 그릴 버튼(순서 = 화면 순서) */
export function makeOtherItems(channel: BuildChannel): MakeOtherItem[] {
  if (channel === 'email') {
    return EMAIL_ENTRY.map((kind) => ({ kind, label: kind === 'library' ? '저장 소재로 이미지 이메일' : LABEL[kind] }));
  }
  return DM_ENTRY.map((kind) => ({ kind, label: LABEL[kind] }));
}

/** 버튼이 갈 주소(카탈로그 = 모바일 DM 화면) · 이메일 블록은 옛 `blank` 그대로 */
export function makeOtherHref(channel: BuildChannel, kind: MakeOtherKind): string {
  if (channel === 'email') return `/email-campaigns?other=${kind === 'blocks' ? 'blank' : kind}`;
  return `/dm-builder?other=${kind}`;
}

/** 모바일 DM 화면 진입 값 읽기 · 옛 `1` · 모르는 값 = null(첫 화면 그대로) */
export function readDmEntry(raw: string | null | undefined): DmEntryKind | null {
  if (raw === 'onestep') return 'line';
  return DM_ENTRY.includes(raw as DmEntryKind) ? (raw as DmEntryKind) : null;
}

/** 이메일 화면 진입 값 읽기 · 옛 `blank` = 블록 */
export function readEmailEntry(raw: string | null | undefined): EmailEntryKind | null {
  if (raw === 'blank') return 'blocks';
  return EMAIL_ENTRY.includes(raw as EmailEntryKind) ? (raw as EmailEntryKind) : null;
}

/**
 * 만들기 칸에 쓴 글을 도착 화면 한 줄 칸으로(라우터 state · 주소에 싣지 않는다).
 * ⛔ 자르지 않는다(★ Codex 1R) — 길이 판정은 도착 화면의 한 줄 관문이 한다(옛 판: 500자 뒤를 말없이 버렸다).
 */
export interface MakeEntryState { makeLine: string }
export function makeEntryState(line: string): MakeEntryState | undefined {
  const t = String(line || '').trim();
  return t ? { makeLine: t } : undefined;
}
export function readMakeEntryLine(state: unknown): string {
  const v = (state as { makeLine?: unknown } | null)?.makeLine;
  return typeof v === 'string' ? v.trim() : '';
}

// 완성 이미지 = 파일 고르기는 누른 화면(만들기)에서만 열 수 있다(브라우저가 사용자 클릭 없는 파일 창을 막는다).
// 고른 파일을 모바일 DM 화면이 한 번만 받는다 · 새로 고침하면 사라진다(그때 도착 화면이 다시 고르라고 알린다).
let handed: File[] | null = null;
export function handOffMakeImages(files: ArrayLike<File> | null | undefined): boolean {
  const arr = files ? Array.from(files) : [];
  if (arr.length === 0) return false;
  handed = arr;
  return true;
}
export function takeMakeImages(): File[] | null {
  const out = handed;
  handed = null;
  return out;
}
