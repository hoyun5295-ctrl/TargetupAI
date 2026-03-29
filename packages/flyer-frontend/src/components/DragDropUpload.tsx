import { useState, useRef } from 'react';

interface DragDropUploadProps {
  accept?: string;
  loading?: boolean;
  onFile: (file: File) => void;
  label?: string;
  hint?: string;
}

export default function DragDropUpload({ accept = '.xlsx,.xls,.csv', loading, onFile, label, hint }: DragDropUploadProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent, over: boolean) => { e.preventDefault(); e.stopPropagation(); setDragging(over); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const allowed = accept.split(',').map(a => a.trim().replace('.', ''));
    if (!allowed.includes(ext)) return;
    onFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) onFile(e.target.files[0]);
    e.target.value = '';
  };

  return (
    <>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleChange} />
      <div
        onClick={() => !loading && inputRef.current?.click()}
        onDragOver={e => handleDrag(e, true)}
        onDragEnter={e => handleDrag(e, true)}
        onDragLeave={e => handleDrag(e, false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all bg-bg/50 ${
          dragging ? 'border-primary-500 bg-primary-50/40 scale-[1.01]' : 'border-border hover:border-primary-500/50 hover:bg-primary-50/30'
        } ${loading ? 'opacity-60 pointer-events-none' : ''}`}
      >
        {loading ? (
          <p className="text-sm text-text-secondary">파일 처리 중...</p>
        ) : (
          <>
            <div className="w-12 h-12 bg-bg rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {dragging ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9.75m3 3H9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75h4.5" />
                )}
              </svg>
            </div>
            <p className="text-sm font-medium text-text mb-1">{label || 'Excel/CSV 파일을 드래그하거나 클릭하세요'}</p>
            <p className="text-xs text-text-muted">{hint || accept.split(',').join(', ') + ' 지원'}</p>
          </>
        )}
      </div>
    </>
  );
}
