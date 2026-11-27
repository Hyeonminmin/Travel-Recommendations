#!/usr/bin/env bash
# Android SDK 없이 앱의 로직과 UI 코드를 검증한다.
#   ./run.sh          # 로직 테스트(실제 백엔드와 통신) + UI 컴파일
#   ./run.sh logic    # 로직 테스트만
#   ./run.sh ui       # UI 컴파일만
#   ./run.sh render   # 화면을 PNG 로 렌더링(ui/build/renders). Mock 백엔드 사용, Google Maven 접근 필요
# 필요: JDK 17+, Gradle 8.x, Node(백엔드 실행), Maven Central 접근. UI 컴파일은 Compose Multiplatform 을 내려받아 무겁다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WHAT="${1:-all}"
PORT="${VERIFY_PORT:-18083}"

start_backend() {
  # 외부 키 없이 Mock 데이터만 쓰는 결정적인 백엔드를 띄운다.
  ( cd "$ROOT/backend" && env -u DATA_GO_KR_SERVICE_KEY -u KAKAO_REST_API_KEY -u SERPAPI_KEY -u TRAVELPAYOUTS_TOKEN \
      USE_OPEN_METEO=false PORT="$PORT" APP_API_TOKEN=dev-token npx tsx src/index.ts >/tmp/android-verify-backend.log 2>&1 ) &
  BACKEND_PID=$!
  trap 'kill $BACKEND_PID 2>/dev/null || true; pkill -P $BACKEND_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 40); do curl -sf "localhost:$PORT/health" >/dev/null 2>&1 && break; sleep 1; done
  curl -sf "localhost:$PORT/health" >/dev/null || { echo "백엔드가 뜨지 않음: /tmp/android-verify-backend.log"; exit 1; }
}

run_logic() {
  start_backend
  gradle -p "$HERE" --no-daemon :logic:test "-Dapi.base=http://localhost:$PORT/" -Dapi.token=dev-token
}

run_ui() { gradle -p "$HERE" --no-daemon :ui:compileKotlin; }

run_render() {
  start_backend
  gradle -p "$HERE" --no-daemon :ui:test "-Dapi.base=http://localhost:$PORT/" -Dapi.token=dev-token
  echo "렌더링 결과: $HERE/ui/build/renders"
}

case "$WHAT" in
  logic) run_logic ;;
  ui) run_ui ;;
  render) run_render ;;
  all) run_logic; run_ui ;;
  *) echo "usage: $0 [all|logic|ui|render]"; exit 2 ;;
esac
