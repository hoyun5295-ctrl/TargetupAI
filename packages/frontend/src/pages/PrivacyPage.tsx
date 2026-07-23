import { Link } from 'react-router-dom';
import { COMPANY_NAME } from '../constants/company';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      <div className="flex-1 py-12 px-4">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">개인정보 처리방침</h1>
          <div className="prose prose-sm text-gray-700 space-y-6">

            <section>
              <p>{COMPANY_NAME}(이하 "회사")는 「개인정보 보호법」 제30조에 따라 정보주체의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 하기 위하여 다음과 같이 개인정보 처리방침을 수립·공개합니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제1조 (개인정보의 처리목적)</h2>
              <p>회사는 다음의 목적을 위하여 개인정보를 처리합니다. 처리하고 있는 개인정보는 다음의 목적 이외의 용도로는 이용되지 않으며, 이용 목적이 변경되는 경우에는 「개인정보 보호법」 제18조에 따라 별도의 동의를 받는 등 필요한 조치를 이행할 예정입니다.</p>
              <p className="mt-2">1. 문자전송 관련: 문자(SMS, MMS, LMS) 전송과 관련하여 회사의 고객사로부터 문자 전송 요청이 있는 경우에만 개인정보를 처리합니다.</p>
              <p>2. 고충처리: 민원인의 신원 확인, 민원사항 확인, 사실조사를 위한 연락·통지, 처리결과 통보 등의 목적으로 개인정보를 처리합니다.</p>
              <p>3. 관계 법령에서 동의 없이 수집·이용할 수 있도록 정해진 경우</p>
              <p>4. 한줄로 서비스 관련(회원 가입·관리 및 서비스 제공): 한줄로 서비스(AI 기반 마케팅 자동화 플랫폼)의 회원 가입에 따른 본인 확인·개인 식별·부정 이용 방지, SMS/LMS/MMS/카카오톡 발송 및 마케팅 자동화 서비스 제공, 서비스 이용에 따른 요금 정산 및 거래내역서 발행</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제2조 (개인정보의 처리 및 보유기간)</h2>
              <p>1. 회사는 법령에 따른 개인정보를 정보주체로부터 수집 시에, 동의받은 개인정보를 이용기간 내에서 처리·보유합니다.</p>
              <p>2. 각각의 개인정보 처리 및 보유 기간은 다음과 같습니다.</p>
              <p className="ml-4">가. 문자전송 관련: 개인정보가 제공된 목적을 달성할 때까지 또는 문자전송에 따른 채권·채무관계 정산 시까지. 다만, 관계 법령 위반에 따른 수사·조사 등이 진행 중인 경우에는 해당 수사·조사 종료 시까지</p>
              <p className="ml-4">나. 고충처리 관련: 민원인의 신원 확인, 민원사항 확인 등 민원해결 종결 시까지</p>
              <p className="ml-4">다. 한줄로 서비스 관련(회원): 회원 탈퇴 또는 이용계약 종료 시까지. 단, 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관 (전자상거래법에 따른 계약·청약철회·대금결제 및 재화 공급 기록 5년, 소비자 불만·분쟁처리 기록 3년, 통신비밀보호법에 따른 접속 기록 3개월 이상)</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제3조 (개인정보의 제3자 제공에 관한 사항)</h2>
              <p>회사는 개인정보를 제1조(개인정보의 처리목적)에서 고지한 범위 내에서 사용하며, 사전 동의 없이는 동 범위를 초과하여 이용하거나 외부에 공개하지 않습니다. 다만, 아래의 경우에는 예외로 합니다.</p>
              <p className="mt-2">1. 사전에 공개에 동의한 경우</p>
              <p>2. 기타 법에 따라 요구된다고 선의로 판단되는 경우(예: 관계 법령에 의거 적법한 절차에 의한 정부·수사기관의 요청이 있는 경우 등)</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제4조 (개인정보처리 위탁에 관한 사항)</h2>
              <p>회사는 원활한 개인정보 업무처리를 위하여 다음과 같이 개인정보 처리업무를 위탁하고 있습니다.</p>
              <p className="mt-2">- 수탁업체: 에스케이텔레콤(SKT), 케이티(KT), 엘지유플러스(LG U+)</p>
              <p>- 위탁업무: SMS, MMS 서비스 등의 서비스를 위한 위탁</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제5조 (정보주체의 권리·의무 및 행사방법)</h2>
              <p>1. 정보주체는 회사에 대해 언제든지 다음 각 호의 개인정보 보호 관련 권리를 행사할 수 있습니다.</p>
              <p className="ml-4">가. 개인정보 열람요구</p>
              <p className="ml-4">나. 오류 등이 있을 경우 정정 요구</p>
              <p className="ml-4">다. 삭제 요구</p>
              <p className="ml-4">라. 처리정지 요구</p>
              <p>2. 제1항에 따른 권리 행사는 회사에 대해 서면, 전화, 전자우편, 모사전송(FAX) 등을 통하여 하실 수 있으며 회사는 이에 대해 지체 없이 조치하겠습니다.</p>
              <p>3. 정보주체가 개인정보의 오류 등에 대한 정정 또는 삭제를 요구한 경우에는 회사는 정정 또는 삭제를 완료할 때까지 당해 개인정보를 이용하거나 제공하지 않습니다.</p>
              <p>4. 제1항에 따른 권리 행사는 정보주체의 법정대리인이나 위임을 받은 자 등 대리인을 통하여 하실 수 있습니다. 이 경우 「개인정보 보호법 시행규칙」 별지 제11호 서식에 따른 위임장을 제출하셔야 합니다.</p>
              <p>5. 정보주체는 개인정보 보호법 등 관계 법령을 위반하여 회사가 처리하고 있는 정보주체 본인이나 타인의 개인정보 및 사생활을 침해하여서는 아니 됩니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제6조 (처리하는 개인정보 항목)</h2>
              <p>1. 문자전송 관련</p>
              <p className="ml-4">- 필수항목: 성명, 전화(휴대폰)번호, 문자전송 내용</p>
              <p className="ml-4">- 선택항목: 해당사항 없음</p>
              <p className="mt-2">2. 고충처리 관련</p>
              <p className="ml-4">- 필수항목: 성명, 전화(휴대폰)번호, 문자전송 내용, 요청일시, 전송일시 등 민원해결을 위한 기타 항목</p>
              <p className="mt-2">3. 한줄로 서비스 관련(회원)</p>
              <p className="ml-4">- 필수항목: 아이디, 비밀번호, 이름, 연락처(휴대폰번호), 이메일, 소속 회사명</p>
              <p className="ml-4">- 선택항목: 부서명, 직위</p>
              <p className="ml-4">- 자동수집항목: IP주소, 접속일시, 서비스 이용기록, 기기정보(브라우저 종류, OS)</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제7조 (개인정보의 파기)</h2>
              <p>1. 회사는 개인정보 보유기간의 경과, 처리목적 달성 등 개인정보가 불필요하게 되었을 때에는 5일 이내에 개인정보를 파기합니다.</p>
              <p>2. 정보주체로부터 동의받은 개인정보 보유기간이 경과하거나 처리목적이 달성되었음에도 불구하고 다른 법령에 따라 개인정보를 계속 보존하여야 하는 경우에는, 해당 개인정보를 별도의 데이터베이스(DB)로 옮기거나 보관 장소를 달리하여 보존합니다.</p>
              <p>3. 개인정보 파기의 절차 및 방법은 다음과 같습니다.</p>
              <p className="ml-4">가. 파기절차: 회사는 파기 사유가 발생한 개인정보를 선정하고, 개인정보 보호책임자의 승인을 받아 개인정보를 파기합니다.</p>
              <p className="ml-4">나. 파기방법: 회사는 전자적 파일 형태로 기록·저장된 개인정보는 기록을 재생할 수 없도록 로우레벨포맷(Low Level Format) 등의 방법을 이용하여 파기하며, 종이 문서에 기록·저장된 개인정보는 분쇄기로 분쇄하거나 소각하여 파기합니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제8조 (개인정보의 안전성 확보조치)</h2>
              <p>회사는 개인정보의 안전성 확보를 위해 다음과 같은 조치를 취하고 있습니다.</p>
              <p className="mt-2">1. 관리적 조치: 내부관리계획 수립·시행, 정기적 직원 교육 등</p>
              <p>2. 기술적 조치: 개인정보처리시스템 등의 접근권한 관리, 접근통제시스템 설치, 고유식별정보 등의 암호화, 보안프로그램 설치</p>
              <p>3. 물리적 조치: 전산실, 자료보관실 등의 접근통제</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제9조 (개인정보 보호책임자)</h2>
              <p>1. 회사는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 개인정보 처리와 관련한 정보주체의 불만처리 및 피해구제 등을 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.</p>
              <p className="mt-2">◉ 개인정보 보호 담당부서</p>
              <p className="ml-4">- 부서명: 연구개발전담부서</p>
              <p className="ml-4">- 담당자: 서수란 팀장</p>
              <p className="ml-4">- 연락처: 070-5143-6861, suran@invitocorp.com, 1800-8125</p>
              <p className="mt-2">◉ 개인정보 열람청구 접수·처리 부서</p>
              <p className="ml-4">- 부서명: 모바일지원팀</p>
              <p className="ml-4">- 담당자: 임은지</p>
              <p className="ml-4">- 연락처: 070-5143-6862, mobile@invitocorp.com, 1800-8125</p>
              <p className="mt-2">2. 정보주체께서는 회사의 서비스(또는 사업)를 이용하시면서 발생한 모든 개인정보 보호 관련 문의, 불만처리, 피해구제 등에 관한 사항을 개인정보 보호책임자 및 담당부서로 문의하실 수 있습니다. 회사는 정보주체의 문의에 대해 지체 없이 답변 및 처리해 드릴 것입니다.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제10조 (개인정보 열람청구)</h2>
              <p>정보주체는 「개인정보 보호법」 제35조에 따른 개인정보의 열람 청구를 아래의 부서에 할 수 있습니다. 회사는 정보주체의 개인정보 열람청구가 신속하게 처리되도록 노력하겠습니다.</p>
              <p className="mt-2">◉ 개인정보 열람청구 접수·처리 부서</p>
              <p className="ml-4">- 부서명: 모바일지원팀</p>
              <p className="ml-4">- 담당자: 임은지</p>
              <p className="ml-4">- 연락처: 070-5143-6862, mobile@invitocorp.com, 1800-8125</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제11조 (권익침해 구제방법)</h2>
              <p>정보주체는 아래의 기관에 대해 개인정보 침해에 대한 피해구제, 상담 등을 문의하실 수 있습니다. 아래의 기관은 회사와는 별개의 기관으로서, 회사의 자체적인 개인정보 불만처리, 피해구제 결과에 만족하지 못하시거나 보다 자세한 도움이 필요하시면 문의하여 주시기 바랍니다.</p>
              <p className="mt-2">◉ 개인정보 침해신고센터 (한국인터넷진흥원 운영)</p>
              <p className="ml-4">- 소관업무: 개인정보 침해사실 신고, 상담 신청</p>
              <p className="ml-4">- 홈페이지: privacy.kisa.or.kr / 전화: (국번없이) 118</p>
              <p className="mt-2">◉ 개인정보 분쟁조정위원회 (한국인터넷진흥원 운영)</p>
              <p className="ml-4">- 소관업무: 개인정보 분쟁조정신청, 집단분쟁조정(민사적 해결)</p>
              <p className="ml-4">- 홈페이지: privacy.kisa.or.kr / 전화: (국번없이) 118</p>
              <p className="mt-2">◉ 대검찰청 사이버범죄수사단: 02-3480-3573 (www.spo.go.kr)</p>
              <p>◉ 경찰청 사이버테러대응센터: 1566-0112 (www.netan.go.kr)</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-2">제12조 (개인정보 처리방침 시행일)</h2>
              <p>본 개인정보 처리방침은 2017년 1월 3일부터 시행합니다. 한줄로 서비스 관련 개인정보 처리 사항은 2026년 7월 23일부터 적용됩니다.</p>
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
