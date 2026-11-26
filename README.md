# 〈로봇이 아닙니다*〉 관람 설문

- `index.html` — 설문 페이지 (한 파일, 빌드 없음). 팀이 정할 값은 파일 맨 위 `CONFIG` 한 곳에 있다.
- `apps-script/Code.gs` — 응답을 구글 스프레드시트에 쌓는 Apps Script 웹 앱.
- `test/run.js` — 명세 9장 1~11번 자동 테스트. `node test/run.js` (Playwright 필요).

## 설정 순서

1. 팀 계정으로 새 스프레드시트를 만들고 탭 이름을 `responses`, `contacts`로 한다.
2. 확장 프로그램 → Apps Script에 `apps-script/Code.gs` 내용을 붙이고 `SHEET_ID`를 시트 주소의 `/d/` 뒤 문자열로 바꾼다.
3. 배포 → 새 배포 → 유형 "웹 앱", 실행 계정 "나", 액세스 권한 "모든 사용자". 권한 승인 후 나오는 `/exec` 주소를 `index.html`의 `CONFIG.ENDPOINT`에 넣는다. (브라우저로 `/exec`를 열어 `{"ok":true,...}`가 보이면 배포가 살아 있는 것)
4. Apps Script 코드를 고치면 배포 관리에서 **새 버전**으로 다시 배포해야 반영된다.
5. `contacts` 탭은 연락 담당자만 보게 한다. 분석용으로 공유할 때는 `responses` 탭만 다른 파일로 복사해 준다.
6. GitHub 저장소에 올리고 Settings → Pages → Branch `main` / `/ (root)`로 켠다. 주소는 `https://<계정>.github.io/<저장소>/`. (대안: Netlify Drop에 폴더를 끌어다 놓기)
7. 배포 주소로 QR을 만든다. 실제 주소에서 아이폰 사파리·안드로이드 크롬으로 끝까지 한 번씩 해 본다.

실제 `SHEET_ID`를 넣은 `Code.gs`는 공개 저장소에 올리지 않는 편이 좋다(저장소의 것은 자리표시자 그대로 둔다).

## 문항을 고칠 때

`CONFIG.FORM_VERSION`을 올린다(`web-v2` …). 열이 늘면 `Code.gs`의 `RESP_COLS`와 시트 머리글도 같이 고친다.
