pub mod fx;
pub mod graph;
pub mod loudness;
pub mod peaks;
#[cfg(feature = "python")]
mod python;
pub mod render;
pub mod wav;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use graph::{Endpoint, Graph, GraphError, NodeId, NodeSpec, PortKind};
pub use loudness::integrated_loudness;
pub use peaks::{peak_pyramid, PeakLevel};
pub use render::{PlayClip, Player};
pub use wav::{decode_wav, probe_wav, AudioBuffer, SampleFormat, WavError, WavInfo};

pub const CRATE_VERSION: &str = env!("CARGO_PKG_VERSION");
