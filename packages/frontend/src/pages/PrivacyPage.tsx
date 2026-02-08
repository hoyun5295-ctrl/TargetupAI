import { Link } from 'react-router-dom';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      <div className="flex-1 py-12 px-4">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">개인정보처리방침</h1>
          <div className="prose prose-sm text-gray-700 space-y-6">

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제1조 (목적)</h2>
              <p>주식회사 인비토(이하 "회사")는 「개인정보 보호법」에 따라 이용자의 개인정보를 보호하고, 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 다음과 같이 개인정보처리방침을 수립·공개합니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제2조 (수집하는 개인정보 항목)</h2>
              <p>회사는 서비스 제공을 위해 다음의 개인정보를 수집합니다.</p>
              <p className="mt-2"><strong>필수항목:</strong> 아이디, 비밀번호, 이름, 연락처(휴대폰번호), 이메일, 소속 회사명</p>
              <p><strong>선택항목:</strong> 부서명, 직위</p>
              <p><strong>자동수집항목:</strong> IP주소, 접속일시, 서비스 이용기록, 기기정보(브라우저 종류, OS)</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제3조 (개인정보의 수집 및 이용 목적)</h2>
              <p>회사는 수집한 개인정보를 다음의 목적을 위해 이용합니다.</p>
              <p className="mt-2">1. 회원 가입 및 관리: 회원제 서비스 이용에 따른 본인 확인, 개인 식별, 부정 이용 방지</p>
              <p>2. 서비스 제공: SMS/LMS/MMS/카카오톡 메시지 발송 서비스, AI 기반 마케팅 자동화 서비스 제공</p>
              <p>3. 요금 정산: 서비스 이용에 따른 요금 정산 및 거래내역서 발행</p>
              <p>4. 고객 지원: 문의사항 처리, 공지사항 전달</p>
              <p>5. 서비스 개선: 서비스 이용 통계, 신규 서비스 개발</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제4조 (개인정보의 보유 및 이용 기간)</h2>
              <p>회사는 개인정보 수집·이용 목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다. 단, 관계 법령에 의해 보존할 필요가 있는 경우 해당 법령에서 정한 기간 동안 보관합니다.</p>
              <p className="mt-2">- 계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래법)</p>
              <p>- 대금결제 및 재화 등의 공급에 관한 기록: 5년 (전자상거래법)</p>
              <p>- 소비자의 불만 또는 분쟁처리에 관한 기록: 3년 (전자상거래법)</p>
              <p>- 접속에 관한 기록: 3개월 이상 (통신비밀보호법)</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제5조 (개인정보의 제3자 제공)</h2>
              <p>회사는 이용자의 개인정보를 제3조에서 명시한 범위 내에서만 처리하며, 이용자의 사전 동의 없이 본래의 범위를 초과하여 처리하거나 제3자에게 제공하지 않습니다. 단, 다음의 경우는 예외로 합니다.</p>
              <p className="mt-2">1. 이용자가 사전에 동의한 경우</p>
              <p>2. 법령의 규정에 의거하거나, 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제6조 (개인정보의 위탁)</h2>
              <p>회사는 서비스 향상을 위해 다음과 같이 개인정보 처리업무를 위탁하고 있습니다.</p>
              <p className="mt-2">- 메시지 발송 대행: QTmsg 중계서버 (SMS/LMS/MMS/카카오톡 메시지 전송)</p>
              <p>- 위탁 업무 내용: 문자메시지 및 카카오톡 메시지 발송</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제7조 (정보주체의 권리·의무)</h2>
              <p>이용자는 언제든지 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지를 요청할 수 있습니다. 이를 위해 회사 고객센터(1800-8125)로 연락하시면 지체 없이 조치하겠습니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제8조 (개인정보의 안전성 확보 조치)</h2>
              <p>회사는 개인정보의 안전성 확보를 위해 다음과 같은 조치를 취하고 있습니다.</p>
              <p className="mt-2">1. 관리적 조치: 내부관리계획 수립·시행, 정기적 직원 교육</p>
              <p>2. 기술적 조치: 개인정보 암호화, 접근통제 시스템 설치, 보안프로그램 설치 및 갱신</p>
              <p>3. 물리적 조치: 전산실, 자료보관실 등 접근 통제</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제9조 (개인정보 보호책임자)</h2>
              <p>회사는 개인정보 처리에 관한 업무를 총괄하는 개인정보 보호책임자를 다음과 같이 지정하고 있습니다.</p>
              <p className="mt-2">- 개인정보 보호책임자: 유호윤 (대표이사)</p>
              <p>- 연락처: 1800-8125</p>
              <p>- 이메일: privacy@invito.kr</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제10조 (방침 변경에 관한 사항)</h2>
              <p>이 개인정보처리방침은 2026년 2월 8일부터 적용됩니다. 변경사항이 있을 경우 웹사이트를 통해 공지하겠습니다.</p>
            </section>

          </div>

          <div className="mt-8 text-center">
            <Link to="/login" className="text-blue-600 hover:text-blue-700 text-sm font-medium">← 로그인으로 돌아가기</Link>
          </div>
        </div>
      </div>

      <footer className="bg-gray-800 text-gray-400 py-4 px-4">
        <div className="max-w-4xl mx-auto text-center text-xs">
          <p>© 2026 INVITO. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}