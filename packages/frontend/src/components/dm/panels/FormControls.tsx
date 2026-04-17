/**
 * FormControls — 속성 패널에서 공용으로 쓰이는 입력 컨트롤 묶음.
 * 디자인 토큰(var(--dm-*))을 참조.
 */
import type { ChangeEvent, ReactNode } from 'react';
import { useRef, useState } from 'react';
import axios from 'axios';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// ────────────── 공용 스타일 ──────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '0 8px',
  border: '1px solid var(--dm-neutral-200)',
  borderRadius: 6,
  fontSize: 12,
  background: 'var(--dm-bg)',
  color: 'var(--dm-neutral-900)',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--dm-neutral-700)',
  marginBottom: 4,
};

// ────────────── Field (라벨 + 입력) ──────────────

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'var(--dm-neutral-500)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

// ────────────── 텍스트 ──────────────

export function TextInput({
  value, onChange, placeholder, type = 'text', min, max,
}: {
  value: string | number | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'url' | 'tel' | 'email';
  min?: number;
  max?: number;
}) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      max={max}
      style={inputStyle}
    />
  );
}

export function TextArea({
  value, onChange, placeholder, rows = 3,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{ ...inputStyle, height: 'auto', minHeight: rows * 18 + 16, padding: 8, resize: 'vertical', lineHeight: 1.5 }}
    />
  );
}

// ────────────── Select ──────────────

export function Select<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{ ...inputStyle, cursor: 'pointer' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ────────────── Toggle (on/off) ──────────────

export function Toggle({ value, onChange, labelOn = '사용', labelOff = '미사용' }: { value: boolean; onChange: (v: boolean) => void; labelOn?: string; labelOff?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        height: 26,
        padding: '0 12px',
        borderRadius: 13,
        border: 'none',
        background: value ? 'var(--dm-primary)' : 'var(--dm-neutral-200)',
        color: value ? '#fff' : 'var(--dm-neutral-700)',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {value ? labelOn : labelOff}
    </button>
  );
}

// ────────────── ColorPicker ──────────────

export function ColorPicker({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="color"
        value={value || '#000000'}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 36, height: 28, padding: 0, border: '1px solid var(--dm-neutral-200)', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
      />
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#4f46e5"
        style={{ ...inputStyle, flex: 1, fontFamily: 'var(--dm-font-mono)', fontSize: 11 }}
      />
    </div>
  );
}

// ────────────── DateTimePicker ──────────────

export function DateTimePicker({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  // ISO 문자열 → datetime-local 포맷 (YYYY-MM-DDTHH:mm)
  const toLocal = (iso?: string): string => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  };
  const fromLocal = (local: string): string => {
    if (!local) return '';
    try { return new Date(local).toISOString(); } catch { return local; }
  };

  return (
    <input
      type="datetime-local"
      value={toLocal(value)}
      onChange={(e) => onChange(fromLocal(e.target.value))}
      style={inputStyle}
    />
  );
}

// ────────────── ImageUploader (DM 이미지 업로드) ──────────────

export function ImageUploader({
  value, onChange, label = '이미지',
}: {
  value: string | undefined;
  onChange: (url: string) => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('images', file);
      const res = await api.post('/dm/upload-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const url = res.data?.images?.[0]?.url || '';
      if (url) onChange(url);
      else setErr('업로드 실패 (응답 형식 오류)');
    } catch (e: any) {
      setErr(e?.response?.data?.error || '업로드 실패');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        {value ? (
          <div style={{ position: 'relative', width: 60, height: 60, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--dm-neutral-200)', flexShrink: 0 }}>
            <img src={value} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <button
              onClick={() => onChange('')}
              style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 9, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >✕</button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={uploading}
          style={{
            flex: 1,
            minHeight: 30,
            padding: '6px 10px',
            border: '1px dashed var(--dm-neutral-300)',
            borderRadius: 6,
            background: 'var(--dm-bg)',
            color: 'var(--dm-neutral-700)',
            fontSize: 11,
            cursor: uploading ? 'wait' : 'pointer',
          }}
        >
          {uploading ? '업로드 중...' : value ? '이미지 변경' : `+ ${label} 업로드`}
        </button>
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
      {err && <div style={{ fontSize: 10, color: 'var(--dm-error)', marginTop: 3 }}>{err}</div>}
    </div>
  );
}
