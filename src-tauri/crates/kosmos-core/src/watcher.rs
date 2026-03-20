use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify_debouncer_mini::new_debouncer;

use kosmos_protocol::events::Event;

use crate::{CoreError, EventSink};

pub struct WatcherManager {
    events: Arc<dyn EventSink>,
    watcher: Mutex<
        Option<(
            notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
            PathBuf,
        )>,
    >,
}

impl WatcherManager {
    pub fn new(events: Arc<dyn EventSink>) -> Self {
        Self {
            events,
            watcher: Mutex::new(None),
        }
    }

    pub fn watch(&self, path: &str) -> Result<(), CoreError> {
        let mut guard = self
            .watcher
            .lock()
            .map_err(|e| CoreError::Other(e.to_string()))?;

        // If already watching this path, do nothing
        if let Some((_, ref current)) = *guard {
            if current == Path::new(path) {
                return Ok(());
            }
        }

        // Drop old watcher
        *guard = None;

        let events = self.events.clone();
        let watch_path = PathBuf::from(path);

        // Build gitignore matcher so we skip events for ignored paths
        let gitignore = {
            let mut builder = GitignoreBuilder::new(&watch_path);
            let gitignore_path = watch_path.join(".gitignore");
            if gitignore_path.exists() {
                let _ = builder.add(gitignore_path);
            }
            Arc::new(
                builder
                    .build()
                    .unwrap_or_else(|_| Gitignore::empty()),
            )
        };

        let mut debouncer = new_debouncer(
            Duration::from_millis(500),
            move |result: Result<
                Vec<notify_debouncer_mini::DebouncedEvent>,
                notify::Error,
            >| {
                if let Ok(fs_events) = result {
                    // Only trigger git refresh if at least one non-ignored file changed
                    let has_trackable = fs_events.iter().any(|e| {
                        !gitignore
                            .matched_path_or_any_parents(&e.path, e.path.is_dir())
                            .is_ignore()
                    });

                    if has_trackable {
                        events.emit(Event::GitChanged);
                    }

                    let mut dirs: Vec<String> = fs_events
                        .iter()
                        .filter_map(|e| e.path.parent().map(|p| p.to_string_lossy().to_string()))
                        .collect();
                    dirs.sort();
                    dirs.dedup();

                    events.emit(Event::FileTreeChanged { dirs });

                    let mut files: Vec<String> = fs_events
                        .iter()
                        .filter(|e| e.path.is_file())
                        .map(|e| e.path.to_string_lossy().to_string())
                        .collect();
                    files.sort();
                    files.dedup();

                    if !files.is_empty() {
                        events.emit(Event::FileContentChanged { files });
                    }
                }
            },
        )
        .map_err(|e| CoreError::Other(e.to_string()))?;

        debouncer
            .watcher()
            .watch(Path::new(path), notify::RecursiveMode::Recursive)
            .map_err(|e| CoreError::Other(e.to_string()))?;

        *guard = Some((debouncer, watch_path));
        Ok(())
    }

    pub fn unwatch(&self) -> Result<(), CoreError> {
        let mut guard = self
            .watcher
            .lock()
            .map_err(|e| CoreError::Other(e.to_string()))?;
        *guard = None;
        Ok(())
    }
}
