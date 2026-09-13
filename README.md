# EBSi 기출문제 다운로더 (GitHub Pages 버전)

정적 파일(HTML/CSS/JS)만으로 이루어진 프런트엔드입니다. 실제 EBSi 서버와의 통신(연도 목록, 검색, 다운로드)은 별도로 배포한 **Cloudflare Worker 프록시**를 통해 이루어집니다. Worker 배포 방법은 `ebsi-worker/README.md`를 참고하세요.

## 배포 전 꼭 할 일

`script.js` 맨 위의 `API_BASE`를 배포한 Worker 주소로 바꿔주세요.

```js
const API_BASE = "https://ebsi-proxy.<당신의-서브도메인>.workers.dev";
```

이 값을 바꾸지 않으면 연도 목록/검색/다운로드가 전부 동작하지 않습니다.

## GitHub Pages에 올리는 방법

1. 새 GitHub 저장소를 만듭니다 (예: `ebsi-downloader`).
2. 이 폴더(`ebsi-pages/`) 안의 파일들(`index.html`, `style.css`, `script.js`, `subjects-data.js`)을 저장소 **루트**에 그대로 올립니다.
   ```bash
   cd ebsi-pages
   git init
   git add .
   git commit -m "EBSi 기출문제 다운로더 (정적 버전)"
   git branch -M main
   git remote add origin https://github.com/<사용자명>/<저장소명>.git
   git push -u origin main
   ```
3. GitHub 저장소 페이지에서 **Settings → Pages**로 이동합니다.
4. **Source**를 `Deploy from a branch`로, **Branch**를 `main` / `/(root)`로 설정하고 저장합니다.
5. 잠시 후 `https://<사용자명>.github.io/<저장소명>/` 주소로 접속하면 사이트가 뜹니다.

## 로컬에서 미리 확인하기

브라우저 보안 정책상 `file://`로 직접 열면 일부 기능이 막힐 수 있어서, 간단한 로컬 서버로 띄워서 확인하는 걸 권장합니다.

```bash
cd ebsi-pages
python3 -m http.server 8000
```

그다음 `http://localhost:8000`으로 접속하세요. (단, `API_BASE`에 실제 배포된 Worker 주소가 들어 있어야 연도 목록/검색이 동작합니다.)

## 참고 사항

- 이 도구는 EBSi가 제공하는 **공개 자료**를 편의상 모아 내려받는 용도이며, **개인 학습 목적**으로만 사용하시길 권장합니다.
- "선택 파일 전체 받기"는 ZIP이 아니라 **개별 파일을 순서대로 다운로드**하는 방식입니다 (이유는 `ebsi-worker/README.md` 참고).
- EBSi가 페이지 구조나 API를 변경하면 `ebsi-worker/src/index.js`의 파싱 로직을 함께 손봐야 할 수 있습니다.
