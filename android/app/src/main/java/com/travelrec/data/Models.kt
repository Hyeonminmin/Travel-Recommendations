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
data class Recommendation(
    val destinationId: String,
    val name: String,
    val country: String,
    val totalScore: Double,
    val estimatedTotalKRW: Long,
    val breakdown: List<FactorResult>,
    val events: List<TripEvent>,
    val dataNotes: List<String>,
    val links: List<Link>,
)

@Serializable
data class Excluded(val destinationId: String, val name: String, val reason: String)

@Serializable
data class RecommendResponse(val results: List<Recommendation>, val excluded: List<Excluded>)
