use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_mini::new_debouncer;

use cosmos_protocol::events::Event;

use crate::EventSink;

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

    pub fn watch(&self, path: &str) -> Result<(), String> {
        let mut guard = self.watcher.lock().map_err(|e| e.to_string())?;

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

        let mut debouncer = new_debouncer(
            Duration::from_millis(500),
            move |result: Result<
                Vec<notify_debouncer_mini::DebouncedEvent>,
                notify::Error,
            >| {
                if let Ok(fs_events) = result {
                    events.emit(Event::GitChanged);

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
        .map_err(|e| e.to_string())?;

        debouncer
            .watcher()
            .watch(Path::new(path), notify::RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        *guard = Some((debouncer, watch_path));
        Ok(())
    }

    pub fn unwatch(&self) -> Result<(), String> {
        let mut guard = self.watcher.lock().map_err(|e| e.to_string())?;
        *guard = None;
        Ok(())
    }
}
