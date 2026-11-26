import { z } from "zod";

export const WEIGHT_KEYS = ["cost", "weather", "event", "lodging", "poi", "logistics"] as const;
export type FactorKey = (typeof WEIGHT_KEYS)[number];

export const recommendRequestSchema = z.object({
  origin: z.string().default("ICN"), // 출발 공항 IATA
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  budgetKRW: z.number().positive(), // 전체 인원 합계 예산
  travelers: z.number().int().min(1).max(10).default(1),
  scope: z.enum(["domestic", "international", "both"]).default("both"),
  tags: z.array(z.string()).default([]), // 예: 미식, 휴양, 자연, 도시, 축제
  weights: z
    .object({
      cost: z.number().min(0).default(0.3),
      weather: z.number().min(0).default(0.2),
      event: z.number().min(0).default(0.15),
      lodging: z.number().min(0).default(0.15),
      poi: z.number().min(0).default(0.1),
      logistics: z.number().min(0).default(0.1),
    })
    .default({}),
  idealTempC: z.tuple([z.number(), z.number()]).default([18, 26]),
});
export type RecommendRequest = z.infer<typeof recommendRequestSchema>;

/** 모든 외부 값은 출처와 기준 시각, 추정 여부를 함께 가진다. */
export interface Sourced<T> {
  value: T;
  source: string;
  asOf: string; // ISO
  estimated: boolean;
}

export interface Destination {
  id: string;
  name: string;
  country: string;
  domestic: boolean;
  iata?: string; // 도착 공항
  lat: number;
  lon: number;
  tags: string[];
  poiDensity: number; // 0..1 (볼거리/식당 밀도 샘플값)
  lodgingRating: number; // 0..5 (샘플값)
  lodgingPerNightKRW: number; // 2인실 기준 샘플값
  dailySpendKRW: number; // 1인 일일 현지 지출 샘플값
  flightHours: number;
  flightBaseKRW: number; // 1인 왕복 샘플값
  climate: { avgTempC: number; rainProb: number }[]; // 12개월(1월=index 0)
}

export interface TripEvent {
  name: string;
  tags: string[];
  startDate: string;
  endDate: string;
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

/** 총점에서 차감되는 항목(가중치 factor 와 별개). */
export interface Penalty {
  kind: "holiday-congestion";
  points: number; // 총점(0..100)에서 차감되는 점수
  reason: string;
}

export interface FactorResult {
  factor: FactorKey;
  score: number; // 0..1
  weight: number; // 정규화된 가중치
  reason: string;
}

export interface Recommendation {
  destinationId: string;
  name: string;
  country: string;
  totalScore: number; // 0..100
  estimatedTotalKRW: number;
  breakdown: FactorResult[];
  events: TripEvent[];
  penalties: Penalty[];
  dataNotes: string[]; // 추정치/샘플 안내
  links: { label: string; url: string }[];
}

export interface ExcludedDestination {
  destinationId: string;
  name: string;
  reason: string;
}
