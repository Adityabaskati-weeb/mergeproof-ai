use std::process::Command;
use tauri_plugin_shell::ShellExt;

fn parse_cli_output(stdout: &[u8], stderr: &[u8]) -> Result<serde_json::Value, String> {
    if stdout.is_empty() {
        return Err(String::from_utf8_lossy(stderr).trim().to_string());
    }
    serde_json::from_slice(stdout).map_err(|error| error.to_string())
}

#[tauri::command]
async fn analyze_pr(
    app: tauri::AppHandle,
    pr_url: String,
    model: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut args = vec!["analyze".to_string(), pr_url, "--json".to_string()];
    if let Some(model) = model.as_deref().filter(|value| !value.trim().is_empty()) {
        args.insert(2, "--model".to_string());
        args.insert(3, model.to_string());
    }

    if let Ok(sidecar) = app.shell().sidecar("mergeproof-cli") {
        let output = sidecar
            .args(args.clone())
            .output()
            .await
            .map_err(|error| error.to_string())?;
        return parse_cli_output(&output.stdout, &output.stderr);
    }

    let custom_cli = std::env::var("MERGEPROOF_CLI").ok();
    let mut command = Command::new(custom_cli.as_deref().unwrap_or("node"));
    if custom_cli.is_none() {
        command.args([
            "node_modules/tsx/dist/cli.mjs",
            "bin/mergeproof.ts",
            "analyze",
        ]);
    } else {
        command.arg("analyze");
    }
    command.args(&args[1..]);
    let output = command.output().map_err(|error| error.to_string())?;
    parse_cli_output(&output.stdout, &output.stderr)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![analyze_pr])
        .run(tauri::generate_context!())
        .expect("error while running MergeProof desktop");
}
