# OMP Studio 플러그인 레지스트리

OMP Studio 플러그인 스토어에 공개할 커뮤니티 플러그인 목록입니다. 플러그인 작성과 패키지 형식은 [OMP Studio 플러그인 작성 가이드](https://github.com/wakhang/omp-studio/blob/main/docs/plugins.md)를 참고하세요. 앱에서는 **설정 → 플러그인 → 스토어**에서 설치할 수 있습니다.

## 플러그인 등록 및 업데이트
OMP Studio에서 에이전트에게 **“이 플러그인 스토어에 올려줘”**라고 요청하면 아래 등록 절차를 진행할 수 있어요. GitHub CLI 로그인과 쓰기 작업 승인이 필요해요.


1. 플러그인을 작성하고 앱에서 직접 동작을 확인합니다. `plugin.json`의 `id`와 버전은 등록 정보와 일치해야 합니다. 패키지는 가이드의 `.ompplugin` 형식이어야 하며 ZIP 파일이 아닙니다.
2. 본인이 소유한 GitHub 저장소에서 버전별 Release를 만들고 `.ompplugin` 파일을 릴리스 에셋으로 올립니다. 스토어에 표시할 Markdown README도 원하면 별도 릴리스 에셋으로 올립니다. 릴리스와 에셋은 공개적으로 다운로드할 수 있어야 합니다. 에셋을 교체하지 말고 변경할 때마다 새 버전을 배포하세요.
3. 이 저장소를 포크하고 `plugins/<id>.json`을 추가하거나 수정합니다. 파일 이름은 플러그인 `id`와 같아야 합니다. `owner`는 릴리스 저장소를 소유한 GitHub 계정 또는 조직입니다. `package`와 선택적인 `readme`에는 각각 해당 소유자의 GitHub Release 에셋 URL, 바이트 크기 `size`, 파일의 SHA-256 해시 `sha256`을 기입합니다. URL은 `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>` 형식입니다. 해시는 다운로드할 에셋의 실제 바이트로 계산하세요.
4. 풀 리퀘스트(PR)를 열고 변경 내용, 소스와 릴리스 링크, 권한 및 검증 방법을 적습니다. PR 작성자는 등록된 `owner`와 일치해야 합니다(관리자 `wakhang` 제외). 기존 항목 업데이트는 기존보다 높은 버전을 사용해야 합니다. 단, 관리자는 파일 해시와 크기 및 다른 메타데이터를 유지하면서 저장소와 에셋 URL만 이전할 수 있습니다. 소유권 변경은 관리자 검토가 필요합니다.
5. 자동 검증과 관리자 리뷰를 통과하면 관리자가 병합합니다. 병합 후 게시 워크플로가 에셋을 가져와 검증하고 서명된 스토어를 배포합니다. PR을 열었다고 즉시 스토어에 나타나는 것은 아닙니다.

등록 정보에는 `id`, `name`, `version`, `description`, `owner`, `package`를 넣고, 필요하면 `author`, `homepage`, `repository`, `minAppVersion`, `tags`, `usage`, `readme`를 추가합니다. `homepage`와 `repository`는 HTTPS URL을 사용하세요. 크기는 바이트 단위이며 SHA-256은 16진수입니다. 선택 README는 최대 256 KiB, 패키지는 압축 및 압축 해제 시 각각 최대 20 MiB입니다. 정확한 패키지·경로 제약과 매니페스트 필드는 위 작성 가이드를 참고하세요.

## 리뷰 및 보안

관리자는 소유권, 릴리스 출처, 패키지 무결성, 설명과 실제 동작, 위험한 권한 및 변경 사항을 검토하며 추가 설명이나 수정을 요청하거나 등록을 거절·제거할 수 있습니다. 자동 검증과 리뷰 또는 목록 등재는 플러그인의 안전성을 보증하지 않습니다.

**플러그인은 코드를 실행합니다.** 특히 메인 프로세스 플러그인은 사용자 권한으로 파일과 네트워크 등 OS 자원에 접근할 수 있습니다. 신뢰할 수 있는 출처와 코드를 확인하고 필요한 권한을 이해한 뒤 사용하세요. 새 설치는 기본적으로 꺼져 있으며 사용자가 직접 켜야 합니다. 스토어 서명 및 해시 검증은 게시된 바이트의 무결성을 확인할 뿐 악성 코드를 판별하지 않습니다. 보안 문제가 의심되면 공개 PR에 민감한 정보나 악용 방법을 올리지 말고 저장소 관리자에게 비공개로 알려 주세요.

## English

This is the community registry for the OMP Studio plugin store. See the [plugin authoring guide](https://github.com/wakhang/omp-studio/blob/main/docs/plugins.md). Publish a versioned `.ompplugin` as a public GitHub Release asset, add or update `plugins/<id>.json` with its owner, URL, byte size and SHA-256, then open a PR for validation and review. Updates require a newer version. Listing, review and signatures do **not** guarantee safety; plugins execute code with user privileges.
