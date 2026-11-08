Goal: Stop the Codex watcher's self-check/waker nudge from re-arming on its own terminal echo, and honour a SHIPWRIGHT-STATUS report before nudging.
Reason: Issue #583: echoed output reset the nudged flag so reminders piled up in the terminal and a valid done:true report was missed.
Reference: https://github.com/svenroth-ai/shipwright-webui/issues/583
