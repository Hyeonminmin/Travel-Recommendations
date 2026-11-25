/**
 * Phase 0: API 키 검증 스크립트. 키 값은 절대 출력하지 않는다.
 *   cp .env.example .env  →  키 입력  →  npm run verify:apis
 */
type Result = { name: string; status: "OK" | "FAIL" | "SKIP"; detail: string };
const results: Result[] = [];
const env = (k: string) => (process.env[k] ?? "").trim();
// data.go.kr 은 Encoding/Decoding 키 두 가지를 주는데, 이미 인코딩된 키면 풀어서 사용(이중 인코딩 방지)
const dataKey = () => {
  const k = env("DATA_GO_KR_SERVICE_KEY");
  return k.includes("%") ? decodeURIComponent(k) : k;
};

async function check(name: string, keyPresent: boolean, run: () => Promise<string>) {
  if (!keyPresent) return results.push({ name, status: "SKIP", detail: "키 없음" });
  try {
    results.push({ name, status: "OK", detail: await run() });
  } catch (e) {
    results.push({ name, status: "FAIL", detail: (e as Error).message.slice(0, 200) });
  }
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON 아님: ${text.slice(0, 120)}`); // data.go.kr 은 오류를 XML 로 줄 때가 있음
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const today = new Date();
const ymd = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
const ym = `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}`;

await check("Open-Meteo (키 불필요)", true, async () => {
  const j = await getJson("https://api.open-meteo.com/v1/forecast?latitude=33.5&longitude=126.53&daily=temperature_2m_mean,precipitation_probability_max&timezone=auto");
  return `daily ${j.daily?.time?.length ?? 0}일치`;
});

await check("Travelpayouts 항공 캐시가", !!env("TRAVELPAYOUTS_TOKEN"), async () => {
  const url = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=ICN&destination=TYO&departure_at=${ym}&currency=krw&limit=5&sorting=price`;
  const j = await getJson(url, { "X-Access-Token": env("TRAVELPAYOUTS_TOKEN") });
  const n = j.data?.length ?? 0;
  if (!j.success && n === 0) throw new Error(JSON.stringify(j).slice(0, 150));
  return `ICN→TYO ${ym} 결과 ${n}건, 최저 ${j.data?.[0]?.price ?? "-"}원`;
});

await check("TourAPI 행사정보", !!env("DATA_GO_KR_SERVICE_KEY"), async () => {
  // 서비스 버전이 바뀐 적이 있어 v2 → v1 순으로 시도
  for (const [svc, op] of [["KorService2", "searchFestival2"], ["KorService1", "searchFestival1"]]) {
    const q = new URLSearchParams({ serviceKey: dataKey(), MobileOS: "ETC", MobileApp: "TravelRec", _type: "json", eventStartDate: ymd, numOfRows: "3", pageNo: "1" });
    try {
      const j = await getJson(`https://apis.data.go.kr/B551011/${svc}/${op}?${q}`);
      const n = j.response?.body?.totalCount;
      if (n !== undefined) return `${svc}: 진행/예정 행사 총 ${n}건`;
    } catch (e) {
      if (svc === "KorService1") throw e;
    }
  }
  throw new Error("KorService2/1 모두 응답 없음 (활용신청 승인 여부 확인)");
});

await check("기상청 단기예보", !!env("DATA_GO_KR_SERVICE_KEY"), async () => {
  const q = new URLSearchParams({ serviceKey: dataKey(), pageNo: "1", numOfRows: "10", dataType: "JSON", base_date: ymd, base_time: "0500", nx: "55", ny: "127" });
  const j = await getJson(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${q}`);
  const code = j.response?.header?.resultCode;
  if (code !== "00") throw new Error(`resultCode=${code} ${j.response?.header?.resultMsg}`);
  return `서울 격자 예보 ${j.response.body.items.item.length}건 수신`;
});

await check("특일(공휴일) 정보", !!env("DATA_GO_KR_SERVICE_KEY"), async () => {
  const q = new URLSearchParams({ serviceKey: dataKey(), solYear: String(today.getFullYear()), solMonth: "12", _type: "json" });
  const j = await getJson(`https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?${q}`);
  return `resultCode=${j.response?.header?.resultCode}, 12월 공휴일 totalCount=${j.response?.body?.totalCount}`;
});

await check("Kakao 로컬(키워드 검색)", !!env("KAKAO_REST_API_KEY"), async () => {
  const j = await getJson(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent("제주 맛집")}&size=3`, {
    Authorization: `KakaoAK ${env("KAKAO_REST_API_KEY")}`,
  });
  return `결과 ${j.documents?.length ?? 0}건 (예: ${j.documents?.[0]?.place_name ?? "-"})`;
});

console.log("\n=== API 검증 결과 ===");
for (const r of results) console.log(`${r.status.padEnd(4)} ${r.name} — ${r.detail}`);
process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
