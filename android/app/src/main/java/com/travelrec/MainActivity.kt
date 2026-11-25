package com.travelrec

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.lifecycle.viewmodel.compose.viewModel
import com.travelrec.ui.RecommendScreen
import com.travelrec.ui.RecommendViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface {
                    val vm: RecommendViewModel = viewModel()
                    RecommendScreen(vm)
                }
            }
        }
    }
}
