//! AU-37: MIDI input read by the engine itself, for the desktop app, whose WebKit WebView has no Web MIDI: midir opens
//! a device through the platform's own MIDI (CoreMIDI on macOS, ALSA's sequencer on Linux, WinMM on Windows) and its
//! callback queues each message with its timestamp; the engine drains the queue and passes the messages to the page,
//! which plays and records them as it does Web MIDI's. The connection lives on a thread of its own (midir's
//! connections are not Send on every platform), so only the queue is shared.

use std::collections::VecDeque;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

/// Messages held for the engine at most: a reader that stops draining loses the oldest, never grows memory without end.
pub const QUEUE_LIMIT: usize = 4096;

/// A message queued as it arrives: midir's timestamp (microseconds) and the bytes; the oldest goes first when full.
pub fn push(queue: &Mutex<VecDeque<(u64, Vec<u8>)>>, stamp: u64, message: &[u8]) {
    if let Ok(mut q) = queue.lock() {
        if q.len() >= QUEUE_LIMIT {
            q.pop_front();
        }
        q.push_back((stamp, message.to_vec()));
    }
}

/// The MIDI input devices, by name.
pub fn inputs() -> Result<Vec<String>, String> {
    let midi = midir::MidiInput::new("formwav").map_err(|e| e.to_string())?;
    Ok(midi.ports().iter().filter_map(|p| midi.port_name(p).ok()).collect())
}

/// One device being read: its messages queue up until drained.
pub struct MidiListener {
    queue: Arc<Mutex<VecDeque<(u64, Vec<u8>)>>>,
    stop: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
    pub name: String,
}

impl MidiListener {
    /// Opens the device named `name` (as `inputs` names it). System exclusive, clock and active sensing are left out:
    /// notes and controllers are what formwav plays and records.
    pub fn open(name: &str) -> Result<MidiListener, String> {
        let queue = Arc::new(Mutex::new(VecDeque::new()));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (want, q) = (name.to_string(), queue.clone());
        let thread = std::thread::Builder::new()
            .name("formwav-midi-input".into())
            .spawn(move || {
                let opened = (|| -> Result<midir::MidiInputConnection<()>, String> {
                    let mut midi = midir::MidiInput::new("formwav").map_err(|e| e.to_string())?;
                    midi.ignore(midir::Ignore::All);
                    let port = midi
                        .ports()
                        .into_iter()
                        .find(|p| midi.port_name(p).map(|n| n == want).unwrap_or(false))
                        .ok_or(format!("no MIDI input named {want}"))?;
                    midi.connect(&port, "formwav-input", move |stamp, message, _| push(&q, stamp, message), ()).map_err(|e| e.to_string())
                })();
                match opened {
                    Ok(connection) => {
                        let _ = ready_tx.send(Ok(()));
                        let _ = stop_rx.recv(); // held open until closed
                        connection.close();
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(MidiListener { queue, stop: Some(stop_tx), thread: Some(thread), name: name.to_string() }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => Err("the MIDI input thread ended before opening".into()),
        }
    }

    /// The messages that arrived since the last drain, oldest first.
    pub fn drain(&self) -> Vec<(u64, Vec<u8>)> {
        self.queue.lock().map(|mut q| q.drain(..).collect()).unwrap_or_default()
    }
}

impl Drop for MidiListener {
    fn drop(&mut self) {
        drop(self.stop.take()); // the thread's recv ends: it closes the connection
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{push, QUEUE_LIMIT};
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// AU-37: messages queue in order with their stamps, and a full queue drops its oldest rather than growing.
    #[test]
    fn the_queue_keeps_order_and_its_limit() {
        let q = Mutex::new(VecDeque::new());
        push(&q, 10, &[0x90, 60, 100]);
        push(&q, 20, &[0x80, 60, 0]);
        let got: Vec<_> = q.lock().unwrap().iter().cloned().collect();
        assert_eq!(got, vec![(10, vec![0x90, 60, 100]), (20, vec![0x80, 60, 0])]);
        for i in 0..(QUEUE_LIMIT as u64 + 5) {
            push(&q, 100 + i, &[0x90, 64, 1]);
        }
        let g = q.lock().unwrap();
        assert_eq!(g.len(), QUEUE_LIMIT);
        // QUEUE_LIMIT + 7 pushed in all: the seven oldest (stamps 10, 20 and 100 to 104) went first
        assert_eq!(g.front().unwrap().0, 105);
    }
}
