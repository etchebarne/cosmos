pub mod events;
pub mod framing;
pub mod requests;
pub mod types;

pub use events::Event;
pub use requests::Request;

/// Convenience trait for converting any `Result<T, E: Display>` to `Result<T, String>`.
pub trait ToStringErr<T> {
    fn str_err(self) -> Result<T, String>;
}

impl<T, E: std::fmt::Display> ToStringErr<T> for Result<T, E> {
    fn str_err(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }
}
