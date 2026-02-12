import { Link } from 'react-router-dom';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      <div className="flex-1 py-12 px-4">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">이용약관</h1>
          <div className="prose prose-sm text-gray-700 space-y-6">

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제1조 (목적)</h2>
              <p>이 약관은 주식회사 인비토(이하 "회사")가 운영하는 한줄로 서비스(이하 "서비스")의 이용 조건 및 절차, 회사와 이용자의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제2조 (정의)</h2>
              <p>1. "서비스"란 회사가 제공하는 SMS/LMS/MMS/카카오톡 메시징 자동화 플랫폼을 말합니다.</p>
              <p>2. "이용자"란 이 약관에 따라 회사가 제공하는 서비스를 이용하는 고객사 및 그 소속 사용자를 말합니다.</p>
              <p>3. "고객사"란 회사와 서비스 이용 계약을 체결한 법인 또는 개인사업자를 말합니다.</p>
              <p>4. "캠페인"이란 이용자가 서비스를 통해 생성하는 메시지 발송 단위를 말합니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제3조 (약관의 효력 및 변경)</h2>
              <p>1. 이 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게 공지함으로써 효력이 발생합니다.</p>
              <p>2. 회사는 필요한 경우 관련 법령을 위배하지 않는 범위에서 이 약관을 변경할 수 있으며, 변경된 약관은 제1항과 같은 방법으로 공지합니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제4조 (서비스의 내용)</h2>
              <p>회사가 제공하는 서비스는 다음과 같습니다.</p>
              <p className="mt-2">1. 마케팅 타겟 추출 서비스</p>
              <p>2. 마케팅 메시지 생성 서비스</p>
              <p>3. SMS/LMS/MMS 문자메시지 발송 서비스</p>
              <p>4. 카카오톡 알림톡/친구톡 발송 서비스</p>
              <p>5. 고객 데이터 관리 및 분석 서비스</p>
              <p>6. 발송 결과 통계 및 리포트 서비스</p>
              <p>7. 기타 회사가 추가 개발하는 서비스</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제5조 (이용 계약의 체결)</h2>
              <p>1. 이용 계약은 고객사가 약관에 동의하고 회사가 이를 승낙함으로써 체결됩니다.</p>
              <p>2. 회사는 다음 각 호에 해당하는 경우 이용 신청을 거절할 수 있습니다.</p>
              <p className="ml-4">가. 타인의 명의를 이용한 경우</p>
              <p className="ml-4">나. 허위 정보를 기재한 경우</p>
              <p className="ml-4">다. 기타 회사가 정한 이용 요건을 충족하지 못한 경우</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제6조 (이용자의 의무)</h2>
              <p>1. 이용자는 관계 법령, 이 약관, 서비스 이용안내 등을 준수하여야 합니다.</p>
              <p>2. 이용자는 다음 행위를 하여서는 안 됩니다.</p>
              <p className="ml-4">가. 수신자의 명시적 동의 없는 광고성 메시지 발송</p>
              <p className="ml-4">나. 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」을 위반하는 스팸 메시지 발송</p>
              <p className="ml-4">다. 타인의 개인정보를 무단으로 수집, 이용하는 행위</p>
              <p className="ml-4">라. 서비스의 안정적 운영을 방해하는 행위</p>
              <p className="ml-4">마. 회사의 지적재산권을 침해하는 행위</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제7조 (회사의 의무)</h2>
              <p>1. 회사는 관계 법령을 준수하고, 이 약관이 정하는 바에 따라 지속적이고 안정적으로 서비스를 제공합니다.</p>
              <p>2. 회사는 이용자의 개인정보를 안전하게 관리하며, 개인정보처리방침을 공시하고 준수합니다.</p>
              <p>3. 회사는 서비스 이용과 관련된 이용자의 불만사항을 신속하게 처리합니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제8조 (요금 및 결제)</h2>
              <p>1. 서비스 이용 요금은 회사가 별도로 정한 요금표에 따르며, 고객사별 계약 협의에 의해 결정됩니다.</p>
              <p>2. 메시지 발송 요금은 실제 발송 성공 건수를 기준으로 정산합니다.</p>
              <p>3. 선불 요금제의 경우, 이용자는 서비스 내 충전 기능을 통해 잔액을 충전한 후 메시지 발송 시 건당 차감되는 종량제 방식으로 이용합니다.</p>
              <p>4. 후불 요금제의 경우, 요금 정산은 월 단위로 이루어지며 회사는 거래내역서를 발행합니다.</p>
              <p>5. 충전 수단은 신용카드, 가상계좌, 계좌이체 등 회사가 지정한 결제 수단을 이용할 수 있습니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제9조 (서비스의 중단)</h2>
              <p>1. 회사는 시스템 정기점검, 증설 및 교체를 위해 서비스를 일시적으로 중단할 수 있으며, 사전에 공지합니다.</p>
              <p>2. 천재지변, 전기통신사업법에 규정된 기간통신사업자의 서비스 중단 등 불가항력적 사유가 있는 경우 서비스를 제한하거나 중단할 수 있습니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제10조 (면책 조항)</h2>
              <p>1. 회사는 이용자가 발송하는 메시지의 내용에 대해 책임을 지지 않습니다.</p>
              <p>2. 회사는 이통사 또는 중계서버의 장애로 인한 발송 실패에 대해 최선을 다하되, 불가항력적 사유에 대해서는 책임을 지지 않습니다.</p>
              <p>3. 이용자가 관계 법령을 위반하여 발생하는 모든 책임은 이용자에게 있습니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제11조 (분쟁 해결)</h2>
              <p>1. 이 약관에 명시되지 않은 사항은 관계 법령 및 상관례에 따릅니다.</p>
              <p>2. 서비스 이용으로 발생한 분쟁에 대해 소송이 제기되는 경우, 서울중앙지방법원을 관할 법원으로 합니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제12조 (환불정책)</h2>
              <p>1. 회사는 이용자가 충전한 선불 잔액 중 미사용 금액에 대하여 환불을 지원합니다.</p>
              <p>2. 이미 발송 완료된 메시지에 대한 발송 비용은 환불이 불가합니다.</p>
              <p>3. 환불 요청은 고객센터(1800-8125) 또는 담당자 이메일을 통해 접수할 수 있습니다.</p>
              <p>4. 환불은 접수일로부터 영업일 기준 3~5일 이내에 처리됩니다.</p>
              <p>5. 카드결제로 충전한 경우 결제 취소를 통해 환불되며, 계좌이체로 충전한 경우 이용자가 지정한 계좌로 환불됩니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">부칙</h2>
              <p>이 약관은 2026년 2월 8일부터 시행합니다.</p>
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
