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
            <div className="w-12 h-12 bg-bg rounded-xl flex items-center justify-center mx-auto mb-3 text-2xl">
              {dragging ? '📥' : '📁'}
            </div>
            <p className="text-sm font-medium text-text mb-1">{label || '파일을 드래그하거나 클릭하여 선택하세요'}</p>
            <p className="text-xs text-text-muted">{hint || accept.split(',').join(', ') + ' 지원'}</p>
          </>
        )}
      </div>
    </>
  );
}
