package com.travelrec.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.travelrec.data.ApiProvider
import com.travelrec.data.RecommendRequest
import com.travelrec.data.RecommendResponse
import com.travelrec.data.Weights
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class UiState(
    val startDate: String = "2026-12-20",
    val endDate: String = "2026-12-24",
    val budgetMan: String = "250", // 만원 단위
    val travelers: String = "2",
    val scope: String = "both",
    val tags: Set<String> = setOf("미식"),
    val weights: Weights = Weights(),
    val loading: Boolean = false,
    val error: String? = null,
    val response: RecommendResponse? = null,
)

class RecommendViewModel : ViewModel() {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun update(block: UiState.() -> UiState) = _state.update(block)

    fun toggleTag(tag: String) = _state.update { it.copy(tags = if (tag in it.tags) it.tags - tag else it.tags + tag) }

    fun search() {
        val s = _state.value
        val budget = s.budgetMan.toLongOrNull()?.times(10_000)
        val people = s.travelers.toIntOrNull()
        if (budget == null || people == null) {
            _state.update { it.copy(error = "예산과 인원은 숫자로 입력하세요") }
            return
        }
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching {
                ApiProvider.api.recommend(
                    RecommendRequest(
                        startDate = s.startDate, endDate = s.endDate, budgetKRW = budget, travelers = people,
                        scope = s.scope, tags = s.tags.toList(), weights = s.weights,
                    ),
                )
            }.onSuccess { r -> _state.update { it.copy(loading = false, response = r) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = "요청 실패: ${e.message}") } }
        }
    }
}
