pub mod graph;

pub use graph::{Endpoint, Graph, GraphError, NodeId, NodeSpec, PortKind};

pub const CRATE_VERSION: &str = env!("CARGO_PKG_VERSION");
