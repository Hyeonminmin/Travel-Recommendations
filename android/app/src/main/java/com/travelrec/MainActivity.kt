package com.travelrec

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.travelrec.ui.DetailScreen
import com.travelrec.ui.RecommendScreen
import com.travelrec.ui.RecommendViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface {
                    val vm: RecommendViewModel = viewModel()
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
