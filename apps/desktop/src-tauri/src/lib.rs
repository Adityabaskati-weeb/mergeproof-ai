use std::process::Command;

#[tauri::command]
fn analyze_pr(pr_url: String) -> Result<serde_json::Value, String> {
    let cli = std::env::var("MERGEPROOF_CLI").unwrap_or_else(|_| "mergeproof".to_string());
    let output = Command::new(cli).args(["analyze", &pr_url, "--json"]).output().map_err(|error| error.to_string())?;
    if !output.status.success() && output.stdout.is_empty() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![analyze_pr])
        .run(tauri::generate_context!())
        .expect("error while running MergeProof desktop");
}
