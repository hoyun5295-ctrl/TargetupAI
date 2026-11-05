/**
 * JourneyKakaoStepEditor — 작업 화면 알림톡 칸 고치기(★ 2026-11-05 C103 F10 · 1104 오류접수 「알림톡 칸을 고칠 곳이 없다」)
 *
 * 부품 = 공용 알림톡 패널(정보 알림 만들기 · 직접 발송과 같은 부품 · 발신프로필 · 승인 템플릿 · 변수 연결 · 대체 발송 · 받는 모습).
 * 값 = 칸 초안의 알림톡 키(칸 PATCH 키 이름 그대로) · 저장 = 작업 화면 「고친 곳 N개 저장」 한 번(지금 저장 길).
 * 재료(발신프로필 · 템플릿 · 고객 칸) = 작업 화면이 알림톡 칸을 처음 열 때 한 번 받아 넘긴다(lib/alimtalk-catalog).
 */
import { Loader2 } from 'lucide-react';
import AlimtalkChannelPanel from '../../alimtalk/AlimtalkChannelPanel';
import AlimtalkVariableMappingPanel from '../../alimtalk/AlimtalkVariableMappingPanel';   // ★ Codex 구현 1R — 변수 연결 입력(패널 밖 부품)
import { alimtalkStateOfStep, alimtalkStepPatchOf, type AlimtalkCatalog, type AlimtalkStepFields } from '../../../lib/alimtalk-catalog';

interface Props {
  step: AlimtalkStepFields;
  /** null = 아직 받는 중 */
  catalog: AlimtalkCatalog | null;
  onPatch: (patch: AlimtalkStepFields) => void;
}

export default function JourneyKakaoStepEditor({ step, catalog, onPatch }: Props) {
  if (!catalog) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-[13.5px] text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden />알림톡 템플릿을 불러오고 있어요
      </div>
    );
  }
  const state = alimtalkStateOfStep(step, catalog.templates, catalog.senders);
  const template = catalog.templates.find((t) => t.template_code === state.templateCode) || null;
  return (
    <div className="space-y-2">
      <AlimtalkChannelPanel
        senders={catalog.senders}
        templates={catalog.templates}
        customerFieldOptions={catalog.fields}
        value={state}
        onChange={(v) => onPatch(alimtalkStepPatchOf(v))}
      />
      {template && (
        <AlimtalkVariableMappingPanel
          selectedTemplate={template}
          variableMap={state.variableMap}
          onVariableMapChange={(next) => onPatch({ alimtalkVariableMap: next })}
          customerFieldOptions={catalog.fields}
          sampleRecipient={null}
          recipientCount={0}
        />
      )}
      <p className="px-1 text-[12.5px] leading-relaxed text-slate-500">알림톡 칸은 고른 템플릿 글 그대로 나가요. 저장하면 다음 알림톡부터 바꾼 템플릿으로 나가요.</p>
    </div>
  );
}
