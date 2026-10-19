import type { EmailCaptureProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Toggle } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function EmailCaptureEditor({ props, onUpdate }: EditorProps<EmailCaptureProps>) {
  return (
    <>
      <Field label="헤드라인"><TextInput value={props.headline} onChange={(v) => onUpdate({ headline: v })} placeholder="뉴스레터 구독하고 혜택 받기" /></Field>
      <Field label="설명 (선택)"><TextArea value={props.description} onChange={(v) => onUpdate({ description: v })} placeholder="구독 안내 문구" rows={2} /></Field>
      <Field label="참여 보상 (선택)" hint="회사가 직접 작성 (예: 첫 구매 쿠폰)"><TextInput value={props.reward_description} onChange={(v) => onUpdate({ reward_description: v })} placeholder="[직접 작성해주세요]" /></Field>
      <Field label="동의 문구"><TextArea value={props.consent_text} onChange={(v) => onUpdate({ consent_text: v })} placeholder="개인정보 수집 및 마케팅 정보 수신 동의" rows={2} /></Field>
      {/* ★ 2026-10-14 표시 기본값 = 미지정 렌더(발행 폼·서버는 명시 true일 때만 동의를 강제한다 · 커버리지 테스트 고정) */}
      <Field label="동의 필수"><Toggle value={props.consent_required ?? true} onChange={(v) => onUpdate({ consent_required: v })} /></Field>
      {/* ★ 2026-10-14 (임은지 접수 ②) 완료 문구 칸은 참여 8종 공용 칸(SectionPropsEditor DoneTextField)으로 옮겼다 — 키(success_text) 동일 */}
      <Field label="법적 고지 (선택)"><TextArea value={props.legal_notice} onChange={(v) => onUpdate({ legal_notice: v })} placeholder="수집 항목·목적·보관기간 안내" rows={2} /></Field>
    </>
  );
}
