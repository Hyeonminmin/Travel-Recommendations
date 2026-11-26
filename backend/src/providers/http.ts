type Fetch = typeof fetch;

/**
 * JSON GET + 일시 오류(연결 reset 등) 1회 재시도. HTTP 오류·JSON 아님(data.go.kr 은 오류를 XML 로 줄 때가 있음)은 예외.
 * 새 Provider 용 공용 함수. 기존 Provider 들은 각자 같은 로직의 사본을 가지고 있다.
 */
export async function getJsonWithRetry(fetchFn: Fetch, url: string, label: string, init?: RequestInit): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchFn(url, init);
      if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${label} non-JSON response`);
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
