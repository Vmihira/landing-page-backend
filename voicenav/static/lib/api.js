// Token-carrying API calls and newline-delimited JSON streams.
const token = document.querySelector('meta[name="demo-token"]').content;
const headers = (extra = {}) => ({ "X-Demo-Token": token, ...extra });

export async function api(path, body = {}) {
  const response = await fetch(`/api/${path}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch { /* empty body */ }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export async function health() {
  return (await fetch("/api/health")).json();
}

export async function transcribe(blob) {
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: headers({ "Content-Type": blob.type || "audio/webm" }),
    body: blob,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Transcription failed");
  return data.text;
}

export async function speech(text) {
  const response = await fetch("/api/speak", {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error("Voice reply failed");
  return response.blob();
}

/** Follow a server event stream. Reconnects from the last sequence number until `done` or abort. */
export function follow(path, body, onEvent, { signal } = {}) {
  let since = 0;
  let stopped = false;
  const run = async () => {
    for (let attempt = 0; !stopped && attempt < 30; attempt++) {
      try {
        const response = await fetch(`/api/${path}`, {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ ...body, since }),
          signal,
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (typeof event.seq === "number") since = event.seq + 1;
            if (event.type === "heartbeat") continue;
            onEvent(event);
            if (event.type === "idle") return;
          }
        }
        return; // The server closed the stream: the job ended.
      } catch (error) {
        if (signal?.aborted) return;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  };
  const promise = run();
  return { promise, stop: () => { stopped = true; } };
}
