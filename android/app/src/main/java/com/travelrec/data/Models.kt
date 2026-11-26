package com.travelrec.data

import kotlinx.serialization.Serializable

@Serializable
data class RecommendRequest(
    val origin: String = "ICN",
    val startDate: String,
    val endDate: String,
    val budgetKRW: Long,
    val travelers: Int = 1,
    val scope: String = "both", // domestic | international | both
    val tags: List<String> = emptyList(),
    val weights: Weights = Weights(),
)

@Serializable
data class Weights(
    val cost: Double = 0.3,
    val weather: Double = 0.2,
    val event: Double = 0.15,
    val lodging: Double = 0.15,
    val poi: Double = 0.1,
    val logistics: Double = 0.1,
)

@Serializable
data class FactorResult(val factor: String, val score: Double, val weight: Double, val reason: String)

@Serializable
data class TripEvent(val name: String, val tags: List<String>, val startDate: String, val endDate: String)

@Serializable
data class Link(val label: String, val url: String)

@Serializable
data class Penalty(val kind: String, val points: Double, val reason: String)

@Serializable
data class Places(val attractions: List<String> = emptyList(), val restaurants: List<String> = emptyList())

@Serializable
data class Recommendation(
    val destinationId: String,
    val name: String,
    val country: String,
    val totalScore: Double,
    val estimatedTotalKRW: Long,
    val breakdown: List<FactorResult>,
    val events: List<TripEvent>,
    val penalties: List<Penalty> = emptyList(), // 구버전 서버 응답에는 없을 수 있어 기본값
    val places: Places = Places(),
    val dataNotes: List<String>,
    val links: List<Link>,
)

@Serializable
data class Excluded(val destinationId: String, val name: String, val reason: String)

@Serializable
data class RecommendResponse(val results: List<Recommendation>, val excluded: List<Excluded>)

// ── POST /destination/{id} ───────────────────────────────────────────────

@Serializable
data class DestinationInfo(
    val id: String,
    val name: String,
    val country: String,
    val domestic: Boolean,
    val tags: List<String> = emptyList(),
    val lat: Double,
    val lon: Double,
)

@Serializable
data class TripInfo(
    val origin: String,
    val startDate: String,
    val endDate: String,
    val nights: Int,
    val rooms: Int,
    val travelers: Int,
    val budgetKRW: Long,
)

/** 모든 금액은 정수(원). 서버가 반올림해서 내려준다. */
@Serializable
data class CostBreakdown(
    val flightPerPersonKRW: Long,
    val flightTotalKRW: Long,
    val lodgingPerNightKRW: Long,
    val lodgingTotalKRW: Long,
    val localSpendKRW: Long,
    val totalKRW: Long,
)

@Serializable
data class Weather(val avgTempC: Double, val rainProb: Double)

@Serializable
data class Holiday(val date: String, val name: String)

/** 항목별 출처. estimated=true 이면 샘플/추정치. */
@Serializable
data class SourceMeta(val source: String, val asOf: String, val estimated: Boolean)

@Serializable
data class DestinationDetail(
    val destination: DestinationInfo,
    val trip: TripInfo,
    val withinBudget: Boolean,
    val recommendation: Recommendation,
    val cost: CostBreakdown,
    val weather: Weather,
    val events: List<TripEvent> = emptyList(),
    val holidays: List<Holiday> = emptyList(),
    val places: Places = Places(),
    val sources: Map<String, SourceMeta> = emptyMap(), // flight, lodging, lodgingRating, weather, event, holiday, poi
    val links: List<Link> = emptyList(),
)
