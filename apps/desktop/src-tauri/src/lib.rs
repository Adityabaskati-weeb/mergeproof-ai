use std::process::Command;
use tauri_plugin_shell::ShellExt;

fn parse_cli_output(stdout: &[u8], stderr: &[u8]) -> Result<serde_json::Value, String> {
    if stdout.is_empty() {
        return Err(String::from_utf8_lossy(stderr).trim().to_string());
    }
    serde_json::from_slice(stdout).map_err(|error| error.to_string())
}

fn cli_args(
    command: &str,
    pr_url: String,
    model: Option<String>,
    provider: Option<String>,
    effort: Option<String>,
    profile: Option<String>,
    agent: Option<String>,
    directories: Option<String>,
    related_repos: Option<String>,
    repo_path: Option<String>,
    criteria: Option<String>,
    verify: Option<String>,
    external_security: bool,
    codeql_database: Option<String>,
    mcp: bool,
    web_search: bool,
    apply: bool,
    remember: bool,
    re_review: bool,
) -> Result<Vec<String>, String> {
    if !matches!(command, "analyze" | "consensus" | "walkthrough" | "erd" | "plan" | "fix" | "simplify" | "tests" | "docstrings" | "review" | "agent" | "task" | "recipe" | "autofix" | "conflicts" | "resolve" | "ask" | "report") {
        return Err(String::from("Unsupported MergeProof command."));
    }
    if command == "review" || command == "agent" {
        let target = if !pr_url.trim().is_empty() { pr_url } else { repo_path.unwrap_or_default() };
        let mut args = vec![command.to_string(), target];
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) {
            args.extend(["--model".to_string(), model]);
        }
        if let Some(provider) = provider.filter(|value| !value.trim().is_empty()) {
            args.extend(["--provider".to_string(), provider]);
        }
        if let Some(effort) = effort.clone().filter(|value| !value.trim().is_empty()) {
            args.extend(["--effort".to_string(), effort]);
        }
        if let Some(profile) = profile.clone().filter(|value| !value.trim().is_empty()) {
            args.extend(["--profile".to_string(), profile]);
        }
        if let Some(agent) = agent.clone().filter(|value| !value.trim().is_empty()) {
            args.extend(["--agent".to_string(), agent]);
        }
        if let Some(directories) = directories.clone().filter(|value| !value.trim().is_empty()) {
            args.push(String::from("--dir"));
            args.extend(directories.split(',').map(|value| value.trim().to_string()).filter(|value| !value.is_empty()));
        }
        if let Some(criteria) = criteria.filter(|value| !value.trim().is_empty()) {
            args.extend(["--criteria".to_string(), criteria]);
        }
        if let Some(verify) = verify.filter(|value| !value.trim().is_empty()) {
            args.extend(["--verify".to_string(), verify]);
        }
        if command == "agent" && re_review {
            args.push(String::from("--re-review"));
        }
        if external_security {
            args.push(String::from("--external-security"));
        }
        if let Some(database) = codeql_database.filter(|value| !value.trim().is_empty()) {
            args.extend(["--codeql-db".to_string(), database]);
        }
        args.push(String::from("--json"));
        return Ok(args);
    }
    if command == "autofix" {
        let mut args = vec![command.to_string(), pr_url];
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) { args.extend(["--model".to_string(), model]); }
        if let Some(provider) = provider.filter(|value| !value.trim().is_empty()) { args.extend(["--provider".to_string(), provider]); }
        if let Some(agent) = agent.filter(|value| !value.trim().is_empty()) { args.extend(["--agent".to_string(), agent]); }
        let repo = repo_path.filter(|value| !value.trim().is_empty()).ok_or_else(|| String::from("Autofix requires an explicit repository path."))?;
        args.extend(["--repo".to_string(), repo]);
        if let Some(verify) = verify.filter(|value| !value.trim().is_empty()) { args.extend(["--verify".to_string(), verify]); }
        if re_review { args.push(String::from("--re-review")); }
        args.push(String::from("--json"));
        return Ok(args);
    }
    if command == "task" {
        let issue = pr_url;
        let repo = repo_path.filter(|value| !value.trim().is_empty()).ok_or_else(|| String::from("Issue agent requires an explicit repository path."))?;
        let mut args = vec![command.to_string(), issue, "--repo".to_string(), repo];
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) { args.extend(["--model".to_string(), model]); }
        if let Some(provider) = provider.filter(|value| !value.trim().is_empty()) { args.extend(["--provider".to_string(), provider]); }
        if let Some(agent) = agent.filter(|value| !value.trim().is_empty()) { args.extend(["--agent".to_string(), agent]); }
        if let Some(verify) = verify.filter(|value| !value.trim().is_empty()) { args.extend(["--verify".to_string(), verify]); }
        if re_review { args.push(String::from("--re-review")); }
        args.push(String::from("--json"));
        return Ok(args);
    }
    if command == "recipe" {
        let recipe_name = criteria.filter(|value| !value.trim().is_empty()).ok_or_else(|| String::from("Recipe action requires a recipe name in the Criteria field."))?;
        let mut args = vec![command.to_string(), pr_url, recipe_name];
        if let Some(repo) = repo_path.filter(|value| !value.trim().is_empty()) { args.extend(["--repo".to_string(), repo]); }
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) { args.extend(["--model".to_string(), model]); }
        if let Some(provider) = provider.filter(|value| !value.trim().is_empty()) { args.extend(["--provider".to_string(), provider]); }
        if let Some(agent) = agent.filter(|value| !value.trim().is_empty()) { args.extend(["--agent".to_string(), agent]); }
        if let Some(verify) = verify.filter(|value| !value.trim().is_empty()) { args.extend(["--verify".to_string(), verify]); }
        if re_review { args.push(String::from("--re-review")); }
        if apply { args.push(String::from("--apply")); }
        args.push(String::from("--json"));
        return Ok(args);
    }
    if command == "ask" {
        let repo = repo_path.filter(|value| !value.trim().is_empty()).ok_or_else(|| String::from("Ask requires an explicit repository path."))?;
        let mut args = vec![command.to_string(), pr_url, "--repo".to_string(), repo];
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) { args.extend(["--model".to_string(), model]); }
        if let Some(provider) = provider.filter(|value| !value.trim().is_empty()) { args.extend(["--provider".to_string(), provider]); }
        if let Some(agent) = agent.filter(|value| !value.trim().is_empty()) { args.extend(["--agent".to_string(), agent]); }
        args.push(String::from("--json"));
        return Ok(args);
    }
    if command == "report" {
        let repo = repo_path.filter(|value| !value.trim().is_empty()).ok_or_else(|| String::from("Report requires an explicit repository path."))?;
        return Ok(vec![command.to_string(), "--repo".to_string(), repo, "--format".to_string(), "json".to_string()]);
    }
    if command == "conflicts" {
        let repo = if !pr_url.trim().is_empty() { pr_url } else { repo_path.unwrap_or_default() };
        let mut args = vec![command.to_string(), repo, "--resolve".to_string()];
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) { args.extend(["--model".to_string(), model]); }
        if let Some(provider) = provider.filter(|value| !value.trim().is_empty()) { args.extend(["--provider".to_string(), provider]); }
        if let Some(criteria) = criteria.filter(|value| !value.trim().is_empty()) { args.extend(["--criteria".to_string(), criteria]); }
        if apply { args.push("--apply".to_string()); }
        args.push("--json".to_string());
        return Ok(args);
    }
    let mut args = vec![command.to_string(), pr_url];
    if command == "consensus" {
        if let Some(model) = model.as_deref().filter(|value| !value.trim().is_empty()) {
            args.push("--model".to_string());
            args.extend(model.split(',').map(|value| value.trim().to_string()).filter(|value| !value.is_empty()));
        }
    } else if let Some(model) = model.as_deref().filter(|value| !value.trim().is_empty()) {
        args.extend(["--model".to_string(), model.to_string()]);
    }
    if command == "consensus" {
        if let Some(provider) = provider.as_deref().filter(|value| !value.trim().is_empty()) {
            args.push("--provider".to_string());
            args.extend(provider.split(',').map(|value| value.trim().to_string()).filter(|value| !value.is_empty()));
        }
    } else if let Some(provider) = provider.as_deref().filter(|value| !value.trim().is_empty()) {
        args.extend(["--provider".to_string(), provider.to_string()]);
    }
    if matches!(command, "analyze" | "consensus" | "walkthrough" | "erd") {
        if let Some(effort) = effort.as_deref().filter(|value| !value.trim().is_empty()) {
            args.extend(["--effort".to_string(), effort.to_string()]);
        }
        if let Some(profile) = profile.as_deref().filter(|value| !value.trim().is_empty()) {
            args.extend(["--profile".to_string(), profile.to_string()]);
        }
    }
    if let Some(agent) = agent.as_deref().filter(|value| !value.trim().is_empty()) {
        args.extend(["--agent".to_string(), agent.to_string()]);
    }
    if matches!(command, "analyze" | "consensus") {
        if let Some(related_repos) = related_repos.as_deref().filter(|value| !value.trim().is_empty()) {
            args.push(String::from("--related-repo"));
            args.extend(related_repos.split(',').map(|value| value.trim().to_string()).filter(|value| !value.is_empty()));
        }
    }
    if command == "analyze" && external_security {
        args.push(String::from("--external-security"));
    }
    if matches!(command, "analyze" | "consensus") && mcp {
        args.push(String::from("--mcp"));
    }
    if matches!(command, "analyze" | "consensus") && web_search {
        args.push(String::from("--web-search"));
    }
    if let Some(database) = codeql_database
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if !matches!(command, "analyze" | "review" | "agent") {
            return Err(String::from("--codeql-db is only valid for analyze, review, and agent."));
        }
        args.extend(["--codeql-db".to_string(), database.to_string()]);
    }
    if let Some(repo_path) = repo_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        args.extend(["--repo".to_string(), repo_path.to_string()]);
    }
    if matches!(command, "review" | "agent") {
        if let Some(directories) = directories.as_deref().filter(|value| !value.trim().is_empty()) {
        args.push(String::from("--dir"));
        args.extend(directories.split(',').map(|value| value.trim().to_string()).filter(|value| !value.is_empty()));
        }
    }
    if apply {
        if !matches!(command, "fix" | "simplify" | "resolve") {
            return Err(String::from("--apply is only valid for fix, simplify, or resolve."));
        }
        args.push(String::from("--apply"));
    }
    if remember {
        if command != "analyze" {
            return Err(String::from(
                "--remember is only valid for the analyze command.",
            ));
        }
        args.push(String::from("--remember"));
    }
    args.push(String::from("--json"));
    Ok(args)
}

#[tauri::command]
async fn run_cli(
    app: tauri::AppHandle,
    command_name: String,
    pr_url: String,
    model: Option<String>,
    provider: Option<String>,
    effort: Option<String>,
    profile: Option<String>,
    agent: Option<String>,
    directories: Option<String>,
    related_repos: Option<String>,
    repo_path: Option<String>,
    criteria: Option<String>,
    verify: Option<String>,
    external_security: bool,
    codeql_database: Option<String>,
    mcp: bool,
    web_search: bool,
    apply: bool,
    remember: bool,
    re_review: bool,
) -> Result<serde_json::Value, String> {
    let args = cli_args(
        &command_name,
        pr_url,
        model,
        provider,
        effort,
        profile,
        agent,
        directories,
        related_repos,
        repo_path,
        criteria,
        verify,
        external_security,
        codeql_database,
        mcp,
        web_search,
        apply,
        remember,
        re_review,
    )?;

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
        command.args(["node_modules/tsx/dist/cli.mjs", "bin/mergeproof.ts"]);
    }
    command.args(&args);
    let output = command.output().map_err(|error| error.to_string())?;
    parse_cli_output(&output.stdout, &output.stderr)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![run_cli])
        .run(tauri::generate_context!())
        .expect("error while running MergeProof desktop");
}
