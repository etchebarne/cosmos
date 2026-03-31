use std::path::Path;
use std::process::Command;

fn main() {
    build_agent();
    tauri_build::build();
}

fn build_agent() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let workspace_root = Path::new(&manifest_dir);
    let resources_dir = workspace_root.join("resources");
    let agent_binary = resources_dir.join("kosmos-agent");

    // Always tell cargo when to re-run this script
    println!("cargo:rerun-if-changed=crates/kosmos-agent/src");
    println!("cargo:rerun-if-changed=crates/kosmos-agent/Cargo.toml");
    println!("cargo:rerun-if-changed=crates/kosmos-core/src");
    println!("cargo:rerun-if-changed=crates/kosmos-core/Cargo.toml");
    println!("cargo:rerun-if-changed=crates/kosmos-protocol/src");
    println!("cargo:rerun-if-changed=crates/kosmos-protocol/Cargo.toml");
    println!("cargo:rerun-if-changed=resources/kosmos-agent");

    // Skip if agent binary is newer than all source files
    if agent_binary.exists() {
        let agent_mtime = std::fs::metadata(&agent_binary)
            .and_then(|m| m.modified())
            .ok();

        let source_dirs = [
            workspace_root.join("crates/kosmos-agent/src"),
            workspace_root.join("crates/kosmos-core/src"),
            workspace_root.join("crates/kosmos-protocol/src"),
        ];

        let cargo_tomls = [
            workspace_root.join("crates/kosmos-agent/Cargo.toml"),
            workspace_root.join("crates/kosmos-core/Cargo.toml"),
            workspace_root.join("crates/kosmos-protocol/Cargo.toml"),
        ];

        let newest_source = source_dirs
            .iter()
            .filter(|d| d.exists())
            .flat_map(|d| walkdir(d))
            .chain(cargo_tomls.iter().filter(|p| p.exists()).cloned())
            .filter_map(|p| std::fs::metadata(&p).and_then(|m| m.modified()).ok())
            .max();

        if let (Some(bin_time), Some(src_time)) = (agent_mtime, newest_source) {
            if bin_time >= src_time {
                return; // Agent is up-to-date
            }
        }
    }

    // Check that the musl target is installed
    let target = "x86_64-unknown-linux-musl";
    let target_check = Command::new("rustup")
        .args(["target", "list", "--installed"])
        .output();

    if let Ok(output) = target_check {
        let installed = String::from_utf8_lossy(&output.stdout);
        if !installed.lines().any(|l| l.trim() == target) {
            println!("cargo:warning=Linux musl target not installed. Run: rustup target add {target}");
            println!("cargo:warning=Skipping kosmos-agent cross-compilation.");
            // Create a placeholder so tauri-build doesn't fail on missing resource
            std::fs::create_dir_all(&resources_dir).ok();
            if !agent_binary.exists() {
                std::fs::write(&agent_binary, b"").ok();
            }
            return;
        }
    }

    std::fs::create_dir_all(&resources_dir).ok();

    let target_dir = workspace_root.join("target").join("agent-linux");

    println!("cargo:warning=Cross-compiling kosmos-agent for {target}...");

    let status = Command::new("cargo")
        .args([
            "build",
            "-p",
            "kosmos-agent",
            "--target",
            target,
            "--target-dir",
            &target_dir.to_string_lossy(),
        ])
        .status();

    match status {
        Ok(s) if s.success() => {
            let built = target_dir.join(target).join("debug").join("kosmos-agent");
            if built.exists() {
                std::fs::copy(&built, &agent_binary).ok();
                println!("cargo:warning=kosmos-agent built successfully.");
            }
        }
        Ok(s) => {
            println!(
                "cargo:warning=kosmos-agent build failed (exit {:?}). Remote features won't work.",
                s.code()
            );
        }
        Err(e) => {
            println!("cargo:warning=Failed to run cargo for kosmos-agent: {e}");
        }
    }
}

fn walkdir(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(walkdir(&path));
            } else {
                files.push(path);
            }
        }
    }
    files
}
