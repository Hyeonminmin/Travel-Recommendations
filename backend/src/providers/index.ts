import { createMockProviders } from "./mock.js";
import { createOpenMeteoWeather } from "./openMeteo.js";
import { createKmaWeather } from "./kma.js";
import { createKakaoPlaces } from "./kakaoPlaces.js";
import { createSpecialDayHolidays } from "./holidays.js";
import { createTourApiEvents } from "./tourApi.js";
import { createTravelpayoutsFlight } from "./travelpayouts.js";
import type { Providers } from "./types.js";

/** 키가 있는 소스만 실제 Provider 로 교체하고 나머지는 Mock 유지. */
export function createProviders(env: NodeJS.ProcessEnv = process.env): { providers: Providers; live: string[] } {
  const mock = createMockProviders();
  const live: string[] = [];
  const providers: Providers = { ...mock };
  if (env.USE_OPEN_METEO !== "false") {
    providers.weather = createOpenMeteoWeather(mock.weather);
    live.push("weather(open-meteo)");
  }
  if (env.TRAVELPAYOUTS_TOKEN) {
    providers.flight = createTravelpayoutsFlight(env.TRAVELPAYOUTS_TOKEN, mock.flight);
    live.push("flight(travelpayouts, 해외만)");
  }
  if (env.DATA_GO_KR_SERVICE_KEY) {
    providers.event = createTourApiEvents(env.DATA_GO_KR_SERVICE_KEY, mock.event);
    live.push("event(TourAPI, 국내만)");
    providers.weather = createKmaWeather(env.DATA_GO_KR_SERVICE_KEY, providers.weather);
    live.push("weather(기상청 단기예보, 국내 근접일)");
    providers.holiday = createSpecialDayHolidays(env.DATA_GO_KR_SERVICE_KEY, mock.holiday);
    live.push("holiday(특일)");
  }
  if (env.KAKAO_REST_API_KEY) {
    providers.place = createKakaoPlaces(env.KAKAO_REST_API_KEY, mock.place);
    live.push("place(Kakao, 국내만)");
  }
  return { providers, live };
}
