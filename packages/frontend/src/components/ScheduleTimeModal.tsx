interface ScheduleTimeModalProps {
  show: boolean;
  reserveDateTime: string;
  setReserveDateTime: (v: string) => void;
  setReserveEnabled: (v: boolean) => void;
  onClose: () => void;
}

export default function ScheduleTimeModal({
  show, reserveDateTime, setReserveDateTime, setReserveEnabled, onClose,
}: ScheduleTimeModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-xl shadow-2xl w-[460px] overflow-hidden">
        <div className="bg-blue-50 px-6 py-5 border-b">
          <h3 className="text-xl font-bold text-blue-700">📅 예약 시간 설정</h3>
        </div>
        <div className="p-6">
          {/* 빠른 선택 */}
          <div className="mb-5">
            <div className="text-sm text-gray-500 mb-2">빠른 선택</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: '1시간 후', hours: 1 },
                { label: '3시간 후', hours: 3 },
                { label: '내일 오전 9시', tomorrow: 9 },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => {
                    const d = new Date();
                    if (opt.hours) {
                      d.setHours(d.getHours() + opt.hours);
                    } else if (opt.tomorrow) {
                      d.setDate(d.getDate() + 1);
                      d.setHours(opt.tomorrow, 0, 0, 0);
                    }
                    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                    setReserveDateTime(local);
                  }}
                  className="py-2 px-2 text-xs border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {/* 직접 선택 */}
          <div>
            <div className="flex gap-4">
              {/* 날짜 */}
              <div className="flex-1">
                <div className="text-xs text-gray-500 mb-2">날짜</div>
                <input
                  type="date"
                  value={reserveDateTime?.split('T')[0] || ''}
                  onChange={(e) => {
                    const time = reserveDateTime?.split('T')[1] || '09:00';
                    setReserveDateTime(`${e.target.value}T${time}`);
                  }}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none"
                />
              </div>
              {/* 시간 */}
              <div className="flex-1">
                <div className="text-xs text-gray-500 mb-2">시간</div>
                <div className="flex items-center gap-1">
                  <select
                    value={reserveDateTime?.split('T')[1]?.split(':')[0] || '09'}
                    onChange={(e) => {
                      const date = reserveDateTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                      const minute = reserveDateTime?.split('T')[1]?.split(':')[1] || '00';
                      setReserveDateTime(`${date}T${e.target.value}:${minute}`);
                    }}
                    className="w-[70px] border-2 border-gray-200 rounded-lg px-1 py-2.5 text-sm text-center focus:border-blue-400 focus:outline-none bg-white cursor-pointer"
                  >
                    {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map(h => (
                      <option key={h} value={h}>{h}시</option>
                    ))}
                  </select>
                  <span className="text-lg font-bold text-gray-400">:</span>
                  <select
                    value={reserveDateTime?.split('T')[1]?.split(':')[1] || '00'}
                    onChange={(e) => {
                      const date = reserveDateTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                      const hour = reserveDateTime?.split('T')[1]?.split(':')[0] || '09';
                      setReserveDateTime(`${date}T${hour}:${e.target.value}`);
                    }}
                    className="w-[70px] border-2 border-gray-200 rounded-lg px-1 py-2.5 text-sm text-center focus:border-blue-400 focus:outline-none bg-white cursor-pointer"
                  >
                    {Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, '0')).map(m => (
                      <option key={m} value={m}>{m}분</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
          {/* 선택된 시간 표시 */}
          {reserveDateTime && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg text-center">
              <span className="text-sm text-gray-600">예약 시간: </span>
              <span className="text-sm font-bold text-blue-700">
                {new Date(reserveDateTime).toLocaleString('ko-KR', {
                  timeZone: 'Asia/Seoul',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>
          )}
        </div>
        <div className="flex border-t">
          <button
            onClick={() => {
              setReserveEnabled(false);
              setReserveDateTime('');
              onClose();
            }}
            className="flex-1 py-3 text-gray-600 hover:bg-gray-50 font-medium"
          >
            취소
          </button>
          <button
            onClick={() => {
              if (!reserveDateTime) {
                const toast = document.createElement('div');
                toast.innerHTML = `
                  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:center;justify-content:center;" onclick="this.parentElement.remove()">
                    <div style="background:white;padding:0;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);width:380px;overflow:hidden;" onclick="event.stopPropagation()">
                      <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);padding:24px;text-align:center;">
                        <div style="font-size:48px;margin-bottom:8px;">⏰</div>
                        <div style="font-size:18px;font-weight:bold;color:#92400e;">시간을 선택해주세요</div>
                      </div>
                      <div style="padding:24px;text-align:center;">
                        <div style="color:#6b7280;margin-bottom:20px;">예약 시간을 먼저 선택해주세요.</div>
                        <button onclick="this.closest('[style*=position]').parentElement.remove()" style="width:100%;padding:12px;background:#f59e0b;color:white;border:none;border-radius:8px;font-weight:bold;font-size:14px;cursor:pointer;">확인</button>
                      </div>
                    </div>
                  </div>
                `;
                document.body.appendChild(toast);
                return;
              }
              const reserveTime = new Date(reserveDateTime);
              const now = new Date();
              if (reserveTime <= now) {
                const toast = document.createElement('div');
                toast.innerHTML = `
                  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:center;justify-content:center;" onclick="this.parentElement.remove()">
                    <div style="background:white;padding:0;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);width:400px;overflow:hidden;" onclick="event.stopPropagation()">
                      <div style="background:linear-gradient(135deg,#fee2e2,#fecaca);padding:24px;text-align:center;">
                        <div style="font-size:48px;margin-bottom:8px;">🚫</div>
                        <div style="font-size:18px;font-weight:bold;color:#dc2626;">예약 불가</div>
                      </div>
                      <div style="padding:24px;text-align:center;">
                        <div style="color:#374151;font-weight:500;margin-bottom:8px;">현재 시간보다 이전으로는 예약할 수 없습니다.</div>
                        <div style="color:#6b7280;margin-bottom:20px;">예약 시간을 다시 선택해주세요.</div>
                        <button onclick="this.closest('[style*=position]').parentElement.remove()" style="width:100%;padding:12px;background:#dc2626;color:white;border:none;border-radius:8px;font-weight:bold;font-size:14px;cursor:pointer;">확인</button>
                      </div>
                    </div>
                  </div>
                `;
                document.body.appendChild(toast);
                return;
              }
              onClose();
            }}
            className="flex-1 py-3 bg-blue-500 text-white hover:bg-blue-600 font-medium"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
