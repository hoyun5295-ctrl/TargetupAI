import { Link } from 'react-router-dom';
import { COMPANY_NAME, CEO_NAME, COMPANY_PHONE, COMPANY_EMAIL } from '../constants/company';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      <div className="flex-1 py-12 px-4">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">개인정보처리방침</h1>
          <div className="prose prose-sm text-gray-700 space-y-6">

            <section>
              <p>{COMPANY_NAME}(이하 "회사")는 「개인정보 보호법」 제30조에 따라 정보주체의 개인정보를 보호하고, 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 다음과 같이 개인정보처리방침을 수립·공개합니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제1조 (개인정보의 처리 목적)</h2>
              <p>회사는 다음의 목적을 위하여 개인정보를 처리하며, 처리하고 있는 개인정보는 다음의 목적 이외의 용도로는 이용되지 않습니다. 이용 목적이 변경되는 경우에는 「개인정보 보호법」 제18조에 따라 별도의 동의를 받는 등 필요한 조치를 이행합니다.</p>
              <p className="mt-2">1. 회원 가입 및 관리: 회원제 서비스 이용에 따른 본인 확인, 개인 식별, 부정 이용 방지</p>
              <p>2. 서비스 제공: SMS/LMS/MMS/카카오톡 메시지 발송 서비스, AI 기반 마케팅 자동화 서비스 제공. 문자(SMS/LMS/MMS) 전송과 관련하여 고객사로부터 전송 요청이 있는 경우에만 수신자 정보를 처리합니다.</p>
              <p>3. 요금 정산: 서비스 이용에 따른 요금 정산 및 거래내역서 발행</p>
              <p>4. 고객 지원(고충처리): 문의사항 처리, 민원인의 신원 확인·민원사항 확인·사실조사를 위한 연락·통지, 처리결과 통보, 공지사항 전달</p>
              <p>5. 서비스 개선: 서비스 이용 통계, 신규 서비스 개발</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제2조 (수집하는 개인정보 항목)</h2>
              <p>회사는 서비스 제공을 위해 다음의 개인정보를 수집합니다.</p>
              <p className="mt-2"><strong>필수항목:</strong> 아이디, 비밀번호, 이름, 연락처(휴대폰번호), 이메일, 소속 회사명</p>
              <p><strong>선택항목:</strong> 부서명, 직위</p>
              <p><strong>문자전송 관련(수신자):</strong> 성명, 전화(휴대폰)번호, 문자전송 내용, 요청·전송 일시</p>
              <p><strong>자동수집항목:</strong> IP주소, 접속일시, 서비스 이용기록, 기기정보(브라우저 종류, OS)</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제3조 (개인정보의 처리 및 보유 기간)</h2>
              <p>회사는 법령에 따른 개인정보 보유·이용 기간 또는 정보주체로부터 동의받은 보유·이용 기간 내에서 개인정보를 처리·보유합니다. 처리 목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다. 단, 관계 법령에 의해 보존할 필요가 있는 경우 해당 법령에서 정한 기간 동안 보관합니다.</p>
              <p className="mt-2">- 문자전송 관련: 개인정보가 제공된 목적을 달성할 때까지 또는 문자전송에 따른 채권·채무관계 정산 시까지(관계 법령 위반에 따른 수사·조사가 진행 중인 경우에는 종료 시까지)</p>
              <p>- 계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래법)</p>
              <p>- 대금결제 및 재화 등의 공급에 관한 기록: 5년 (전자상거래법)</p>
              <p>- 소비자의 불만 또는 분쟁처리에 관한 기록: 3년 (전자상거래법)</p>
              <p>- 접속에 관한 기록: 3개월 이상 (통신비밀보호법)</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제4조 (개인정보의 제3자 제공)</h2>
              <p>회사는 이용자의 개인정보를 제1조에서 명시한 범위 내에서만 처리하며, 이용자의 사전 동의 없이 본래의 범위를 초과하여 처리하거나 제3자에게 제공하지 않습니다. 단, 다음의 경우는 예외로 합니다.</p>
              <p className="mt-2">1. 이용자가 사전에 동의한 경우</p>
              <p>2. 법령의 규정에 의거하거나, 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제5조 (개인정보 처리의 위탁)</h2>
              <p>회사는 원활한 서비스 제공을 위해 다음과 같이 개인정보 처리업무를 위탁하고 있으며, 위탁계약 시 개인정보가 안전하게 관리될 수 있도록 필요한 사항을 규정하고 관리·감독합니다.</p>
              <p className="mt-2">- SK텔레콤(SKT), KT, LG U+: 이동통신망을 통한 SMS/LMS/MMS 메시지 전송</p>
              <p>- 메시지 중계(QTmsg 중계서버): 문자메시지 및 카카오톡 메시지 발송 대행</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제6조 (정보주체의 권리·의무 및 행사방법)</h2>
              <p>1. 정보주체는 회사에 대해 언제든지 개인정보 열람, 정정, 삭제, 처리정지를 요구할 수 있습니다.</p>
              <p>2. 제1항에 따른 권리 행사는 회사에 대해 서면, 전화, 전자우편, 모사전송(FAX) 등을 통하여 하실 수 있으며, 회사는 이에 대해 지체 없이 조치합니다.</p>
              <p>3. 정보주체가 개인정보의 오류 등에 대한 정정 또는 삭제를 요구한 경우, 회사는 정정 또는 삭제를 완료할 때까지 해당 개인정보를 이용하거나 제공하지 않습니다.</p>
              <p>4. 권리 행사는 정보주체의 법정대리인이나 위임을 받은 자 등 대리인을 통하여 하실 수 있으며, 이 경우 「개인정보 보호법 시행규칙」 별지 제11호 서식에 따른 위임장을 제출하셔야 합니다.</p>
              <p>5. 정보주체는 관계 법령을 위반하여 회사가 처리하고 있는 본인이나 타인의 개인정보 및 사생활을 침해하여서는 아니 됩니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제7조 (개인정보의 파기)</h2>
              <p>1. 회사는 개인정보 보유기간의 경과, 처리목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이(5일 이내) 해당 개인정보를 파기합니다.</p>
              <p>2. 보유기간이 경과하거나 처리목적이 달성되었음에도 다른 법령에 따라 계속 보존하여야 하는 경우에는, 해당 개인정보를 별도의 데이터베이스(DB)로 옮기거나 보관 장소를 달리하여 보존합니다.</p>
              <p>3. 파기절차 및 방법은 다음과 같습니다.</p>
              <p className="ml-4">- 파기절차: 파기 사유가 발생한 개인정보를 선정하고, 개인정보 보호책임자의 승인을 받아 파기합니다.</p>
              <p className="ml-4">- 파기방법: 전자적 파일 형태로 기록·저장된 개인정보는 기록을 재생할 수 없도록 로우레벨포맷(Low Level Format) 등의 방법으로 파기하며, 종이 문서에 기록·저장된 개인정보는 분쇄기로 분쇄하거나 소각하여 파기합니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제8조 (개인정보의 안전성 확보 조치)</h2>
              <p>회사는 개인정보의 안전성 확보를 위해 다음과 같은 조치를 취하고 있습니다.</p>
              <p className="mt-2">1. 관리적 조치: 내부관리계획 수립·시행, 정기적 직원 교육</p>
              <p>2. 기술적 조치: 개인정보처리시스템 등의 접근권한 관리, 접근통제시스템 설치, 고유식별정보 등의 암호화, 보안프로그램 설치 및 갱신</p>
              <p>3. 물리적 조치: 전산실, 자료보관실 등 접근 통제</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제9조 (개인정보 보호책임자)</h2>
              <p>회사는 개인정보 처리에 관한 업무를 총괄하여 책임지고, 개인정보 처리와 관련한 정보주체의 불만처리 및 피해구제 등을 위하여 다음과 같이 개인정보 보호책임자를 지정하고 있습니다.</p>
              <p className="mt-2">- 개인정보 보호책임자: {CEO_NAME} (대표이사)</p>
              <p>- 연락처: {COMPANY_PHONE}</p>
              <p>- 이메일: {COMPANY_EMAIL}</p>
              <p className="mt-2">정보주체께서는 서비스를 이용하시면서 발생한 모든 개인정보 보호 관련 문의, 불만처리, 피해구제 등에 관한 사항을 개인정보 보호책임자 및 담당부서로 문의하실 수 있으며, 회사는 지체 없이 답변 및 처리해 드립니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제10조 (개인정보 열람청구)</h2>
              <p>정보주체는 「개인정보 보호법」 제35조에 따른 개인정보의 열람 청구를 아래 부서에 하실 수 있으며, 회사는 열람청구가 신속하게 처리되도록 노력합니다.</p>
              <p className="mt-2">- 개인정보 열람청구 접수·처리 부서: 모바일지원팀</p>
              <p>- 연락처: {COMPANY_PHONE}, {COMPANY_EMAIL}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제11조 (권익침해 구제방법)</h2>
              <p>정보주체는 개인정보 침해로 인한 구제를 받기 위하여 아래의 기관에 분쟁해결이나 상담 등을 신청할 수 있습니다. 아래 기관은 회사와는 별개의 기관으로서, 회사의 자체적인 개인정보 불만처리·피해구제 결과에 만족하지 못하시거나 보다 자세한 도움이 필요하시면 문의하시기 바랍니다.</p>
              <p className="mt-2">- 개인정보 침해신고센터 (한국인터넷진흥원 운영): (국번없이) 118, privacy.kisa.or.kr</p>
              <p>- 개인정보 분쟁조정위원회: 1833-6972, www.kopico.go.kr</p>
              <p>- 대검찰청 사이버수사과: (국번없이) 1301, www.spo.go.kr</p>
              <p>- 경찰청 사이버수사국: (국번없이) 182, ecrm.police.go.kr</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제12조 (개인정보처리방침의 변경 및 시행일)</h2>
              <p>이 개인정보처리방침은 2026년 7월 23일부터 적용됩니다. 법령·방침 또는 보안기술의 변경에 따라 내용의 추가·삭제 및 수정이 있을 경우에는 변경사항의 시행 7일 전부터 웹사이트를 통해 공지합니다.</p>
            </section>

          </div>

          <div className="mt-8 text-center">
            <Link to="/login" className="text-blue-600 hover:text-blue-700 text-sm font-medium">← 로그인으로 돌아가기</Link>
          </div>
        </div>
      </div>

      <footer className="bg-gray-800 text-gray-400 py-4 px-4">
        <div className="max-w-4xl mx-auto text-center text-xs">
          <p>© {new Date().getFullYear()} INVITO. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
