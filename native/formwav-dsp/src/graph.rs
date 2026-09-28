use std::collections::VecDeque;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId(u32);

impl NodeId {
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortKind {
    Audio { channels: u16 },
    Event,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeSpec {
    pub name: String,
    pub inputs: Vec<PortKind>,
    pub outputs: Vec<PortKind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Endpoint {
    pub node: NodeId,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphError {
    UnknownNode(NodeId),
    UnknownOutput(Endpoint),
    UnknownInput(Endpoint),
    KindMismatch { from: PortKind, to: PortKind },
    AlreadyConnected,
    Cycle,
    ZeroChannels,
}

impl fmt::Display for GraphError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GraphError::UnknownNode(n) => write!(f, "unknown node {}", n.0),
            GraphError::UnknownOutput(e) => write!(f, "node {} has no output port {}", e.node.0, e.port),
            GraphError::UnknownInput(e) => write!(f, "node {} has no input port {}", e.node.0, e.port),
            GraphError::KindMismatch { from, to } => write!(f, "cannot connect {from:?} to {to:?}"),
            GraphError::AlreadyConnected => write!(f, "these ports are already connected"),
            GraphError::Cycle => write!(f, "the connection would create a cycle"),
            GraphError::ZeroChannels => write!(f, "an audio port needs at least one channel"),
        }
    }
}

impl std::error::Error for GraphError {}

#[derive(Debug, Default, Clone)]
pub struct Graph {
    nodes: Vec<NodeSpec>,
    edges: Vec<(Endpoint, Endpoint)>,
}

impl Graph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_node(&mut self, spec: NodeSpec) -> Result<NodeId, GraphError> {
        let has_empty_audio = spec
            .inputs
            .iter()
            .chain(spec.outputs.iter())
            .any(|k| matches!(k, PortKind::Audio { channels: 0 }));
        if has_empty_audio {
            return Err(GraphError::ZeroChannels);
        }
        self.nodes.push(spec);
        Ok(NodeId((self.nodes.len() - 1) as u32))
    }

    pub fn node(&self, id: NodeId) -> Option<&NodeSpec> {
        self.nodes.get(id.index())
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn edges(&self) -> &[(Endpoint, Endpoint)] {
        &self.edges
    }

    pub fn connect(&mut self, from: Endpoint, to: Endpoint) -> Result<(), GraphError> {
        let out_kind = *self
            .node(from.node)
            .ok_or(GraphError::UnknownNode(from.node))?
            .outputs
            .get(from.port as usize)
            .ok_or(GraphError::UnknownOutput(from))?;
        let in_kind = *self
            .node(to.node)
            .ok_or(GraphError::UnknownNode(to.node))?
            .inputs
            .get(to.port as usize)
            .ok_or(GraphError::UnknownInput(to))?;
        if out_kind != in_kind {
            return Err(GraphError::KindMismatch { from: out_kind, to: in_kind });
        }
        if self.edges.contains(&(from, to)) {
            return Err(GraphError::AlreadyConnected);
        }
        if from.node == to.node || self.reaches(to.node, from.node) {
            return Err(GraphError::Cycle);
        }
        self.edges.push((from, to));
        Ok(())
    }

    pub fn disconnect(&mut self, from: Endpoint, to: Endpoint) -> bool {
        let before = self.edges.len();
        self.edges.retain(|e| *e != (from, to));
        before != self.edges.len()
    }

    pub fn order(&self) -> Result<Vec<NodeId>, GraphError> {
        let n = self.nodes.len();
        let mut indegree = vec![0usize; n];
        for (_, to) in &self.edges {
            indegree[to.node.index()] += 1;
        }
        let mut ready: VecDeque<usize> = (0..n).filter(|&i| indegree[i] == 0).collect();
        let mut out = Vec::with_capacity(n);
        while let Some(i) = ready.pop_front() {
            out.push(NodeId(i as u32));
            for (from, to) in &self.edges {
                if from.node.index() == i {
                    let j = to.node.index();
                    indegree[j] -= 1;
                    if indegree[j] == 0 {
                        ready.push_back(j);
                    }
                }
            }
        }
        if out.len() == n {
            Ok(out)
        } else {
            Err(GraphError::Cycle)
        }
    }

    fn reaches(&self, start: NodeId, target: NodeId) -> bool {
        let mut seen = vec![false; self.nodes.len()];
        let mut stack = vec![start];
        while let Some(node) = stack.pop() {
            if node == target {
                return true;
            }
            if std::mem::replace(&mut seen[node.index()], true) {
                continue;
            }
            for (from, to) in &self.edges {
                if from.node == node && !seen[to.node.index()] {
                    stack.push(to.node);
                }
            }
        }
        false
    }
}
