한줄로 Sync Agent - 자기완결 패키지 (인비토 / Windows Server 2008 R2)

[설치 / 진단 - 한 방]
1. 이 SyncAgent 폴더를 인비토 PC에 통째로 복사 (예: C:\SyncAgent)  ※ Program Files 말고 C:\ 바로 아래 권장(쓰기권한)
2. INSTALL-run-as-admin.bat 우클릭 -> 관리자 권한으로 실행
3. 화면에 결과가 뜨고, 같은 폴더에 diagnose.txt 가 생깁니다.

[결과 읽는 법]
- 'sync-agent v1.5.5' + EXIT_CODE=0  -> 런타임 정상. 서비스 자동 등록/시작됨.
- exe가 안 뜨면(에러창이 없어도)  -> diagnose.txt 의 EXIT_CODE 숫자가 원인입니다.
  그 diagnose.txt 파일을 그대로 보내주세요. 에러창 없이도 원인 100% 가립니다.

[핵심] 빠졌던 C 런타임 DLL(UCRT 46 + vcruntime/msvcp)을 폴더에 모두 동봉.
       vc_redist 설치 / 인터넷 / 재부팅 전부 불필요.
