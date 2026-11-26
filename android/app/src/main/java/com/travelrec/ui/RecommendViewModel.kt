package com.travelrec.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.travelrec.data.ApiProvider
import com.travelrec.data.DestinationDetail
import com.travelrec.data.Recommendation
import com.travelrec.data.RecommendRequest
import com.travelrec.data.RecommendResponse
import com.travelrec.data.Weights
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** 상세 화면 상태. destinationId 로 늦게 도착한 응답이 다른 화면을 덮어쓰지 않게 구분한다. */
data class DetailState(
    val destinationId: String,
    val name: String,
    val loading: Boolean = true,
    val error: String? = null,
    val data: DestinationDetail? = null,
)

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
    /** 현재 목록을 만든 요청. 상세 호출에 그대로 보내야 점수·가중치가 목록과 일치한다(입력창을 고쳐도 변하지 않음). */
    val lastRequest: RecommendRequest? = null,
    val detail: DetailState? = null,
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
        val request = RecommendRequest(
            startDate = s.startDate, endDate = s.endDate, budgetKRW = budget, travelers = people,
            scope = s.scope, tags = s.tags.toList(), weights = s.weights,
        )
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { ApiProvider.api.recommend(request) }
                .onSuccess { r -> _state.update { it.copy(loading = false, response = r, lastRequest = request) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = "요청 실패: ${e.message}") } }
        }
    }

    private var detailJob: Job? = null

    /** 목록 카드의 "상세 보기". 목록을 만든 요청(lastRequest)으로 /destination/{id} 를 호출한다. */
    fun openDetail(r: Recommendation) = loadDetail(r.destinationId, r.name)

    fun retryDetail() {
        val d = _state.value.detail ?: return
        loadDetail(d.destinationId, d.name)
    }

    fun closeDetail() {
        detailJob?.cancel()
        _state.update { it.copy(detail = null) }
    }

    private fun loadDetail(id: String, name: String) {
        val request = _state.value.lastRequest ?: return
        detailJob?.cancel()
        _state.update { it.copy(detail = DetailState(destinationId = id, name = name)) }
        detailJob = viewModelScope.launch {
            runCatching { ApiProvider.api.destination(id, request) }
                .onSuccess { d -> updateDetail(id) { it.copy(loading = false, error = null, data = d) } }
                .onFailure { e ->
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    updateDetail(id) { it.copy(loading = false, error = "상세 정보를 불러오지 못했습니다: ${e.message}") }
                }
        }
    }

    /** 응답이 올 때 같은 목적지의 상세 화면이 아직 열려 있을 때만 반영한다. */
    private fun updateDetail(id: String, block: (DetailState) -> DetailState) =
        _state.update { st -> st.detail?.takeIf { it.destinationId == id }?.let { st.copy(detail = block(it)) } ?: st }
}
