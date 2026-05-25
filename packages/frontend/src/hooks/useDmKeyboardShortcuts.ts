/**
 * useDmKeyboardShortcuts — D216+ 모바일DM 빌더 키보드 단축키 hook
 *
 * 매핑:
 *   - Cmd/Ctrl+Z         → undo
 *   - Cmd/Ctrl+Y         → redo
 *   - Cmd/Ctrl+Shift+Z   → redo
 *   - Cmd/Ctrl+S         → save
 *   - Cmd/Ctrl+K         → section search modal
 *   - Delete / Backspace → remove selected section (편집기 안 X)
 *
 * 호출 영역: DmBuilderPage (편집 모드 진입 시 활성)
 */

import { useEffect } from 'react';
import { useDmBuilderStore } from '../stores/dmBuilderStore';

export interface DmKeyboardOptions {
  enabled?: boolean;
}

export function useDmKeyboardShortcuts(options: DmKeyboardOptions = {}) {
  const enabled = options.enabled ?? true;

  const undo = useDmBuilderStore((s) => s.undo);
  const redo = useDmBuilderStore((s) => s.redo);
  const canUndo = useDmBuilderStore((s) => s.canUndo);
  const canRedo = useDmBuilderStore((s) => s.canRedo);
  const save = useDmBuilderStore((s) => s.save);
  const selectedSectionId = useDmBuilderStore((s) => s.selectedSectionId);
  const removeSection = useDmBuilderStore((s) => s.removeSection);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // 편집기 / 입력기 안 키 영역 무시
      const target = e.target as HTMLElement | null;
      if (target && target.matches?.('input, textarea, [contenteditable="true"]')) {
        return;
      }

      const isMac =
        typeof navigator !== 'undefined' &&
        (navigator.platform || '').toLowerCase().includes('mac');
      const cmd = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl + Z (undo)
      if (cmd && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (canUndo()) undo();
        return;
      }

      // Cmd/Ctrl + Y or Cmd/Ctrl + Shift + Z (redo)
      if (
        (cmd && e.key.toLowerCase() === 'y') ||
        (cmd && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        if (canRedo()) redo();
        return;
      }

      // Cmd/Ctrl + S (save)
      if (cmd && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }

      // Cmd/Ctrl + K (section search modal — 옛 modal 영역 활용 시)
      if (cmd && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // 옛 ModalKey 안 'ai-prompt' 영역 활용 (가장 가까운 검색 영역)
        setOpenModal('ai-prompt');
        return;
      }

      // Delete / Backspace (선택 섹션 삭제)
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSectionId) {
        e.preventDefault();
        removeSection(selectedSectionId);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, undo, redo, canUndo, canRedo, save, selectedSectionId, removeSection, setOpenModal]);
}
