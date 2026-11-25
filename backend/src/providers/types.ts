import type { Destination, Sourced, TripEvent } from "../types.js";

export interface TripQuery {
  origin: string;
  startDate: string;
  endDate: string;
  travelers: number;
}

/** 외부 API 어댑터 인터페이스. 소스가 바뀌면 구현체만 교체한다. */
export interface FlightProvider {
  roundTripPerPersonKRW(dest: Destination, q: TripQuery): Promise<Sourced<number>>;
}
export interface LodgingProvider {
  perNightKRW(dest: Destination, q: TripQuery): Promise<Sourced<number>>;
  rating(dest: Destination): Promise<Sourced<number>>;
}
export interface WeatherProvider {
  forecast(dest: Destination, q: TripQuery): Promise<Sourced<{ avgTempC: number; rainProb: number }>>;
}
export interface EventProvider {
  events(dest: Destination, q: TripQuery): Promise<Sourced<TripEvent[]>>;
}
export interface Providers {
  flight: FlightProvider;
  lodging: LodgingProvider;
  weather: WeatherProvider;
  event: EventProvider;
}
