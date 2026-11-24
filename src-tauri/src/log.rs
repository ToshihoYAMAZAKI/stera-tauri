use crate::{log_create_new, log_println};

pub fn process_data(id: u32) {
    // 追記出力
    log_println!("[Rust] データ処理開始: id={}", id);
    
    // 新規作成（上書きリセット）したい場合
    // log_create_new!("[Rust] ログをリセットしました");
}