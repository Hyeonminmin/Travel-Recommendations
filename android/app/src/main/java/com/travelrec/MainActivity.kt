package com.travelrec

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.travelrec.data.ApiProvider
import com.travelrec.ui.DetailScreen
import com.travelrec.ui.RecommendScreen
import com.travelrec.ui.RecommendViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 저장해 둔 서버 주소를 복원한다(ViewModel 이 만들어지기 전에 적용해야 입력창 초기값에 반영된다)
        val prefs = getSharedPreferences("settings", MODE_PRIVATE)
        prefs.getString("server_url", null)?.let { ApiProvider.setBaseUrl(it) }
        setContent {
            MaterialTheme {
                Surface {
                    val vm: RecommendViewModel = viewModel()
                    remember(vm) { vm.onServerUrlSaved = { prefs.edit().putString("server_url", it).apply() } }
                    val state by vm.state.collectAsStateWithLifecycle()
                    // 상세에서 돌아왔을 때 목록 스크롤 위치를 유지하려고 목록 상태를 여기서 들고 있다
                    val listState = rememberLazyListState()
                    val detail = state.detail
                    if (detail != null) {
                        BackHandler(onBack = vm::closeDetail)
                        DetailScreen(detail, onBack = vm::closeDetail, onRetry = vm::retryDetail)
                    } else {
                        RecommendScreen(vm, listState)
                    }
                }
            }
        }
    }
}
