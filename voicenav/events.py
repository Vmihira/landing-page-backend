"""Replayable progress streams for long jobs (Studio builds, Navigator runs).

Ordinary events are kept so a client can reconnect at any sequence number and catch up. Large, rapidly
replaced values (live frames, partial previews) live in "latest" slots: a follower only receives the
newest version, never a backlog.
"""

import threading
import time


class Channel:
    def __init__(self, keep=4000):
        self.keep = keep
        self.events = []
        self.base = 0
        self.latest = {}
        self.versions = {}
        self.closed = False
        self.cond = threading.Condition()

    def push(self, kind, /, **data):
        with self.cond:
            event = {"seq": self.base + len(self.events), "type": kind, "t": round(time.time(), 3), **data}
            self.events.append(event)
            if len(self.events) > self.keep:
                drop = len(self.events) - self.keep
                del self.events[:drop]
                self.base += drop
            self.cond.notify_all()
            return event

    def set_latest(self, slot, /, **data):
        with self.cond:
            self.versions[slot] = self.versions.get(slot, 0) + 1
            self.latest[slot] = {"type": slot, "version": self.versions[slot], **data}
            self.cond.notify_all()

    def close(self):
        with self.cond:
            self.closed = True
            self.cond.notify_all()

    def follow(self, since=0, heartbeat=15.0):
        """Yield events from `since`, then newer events and latest-slot updates until the channel closes.

        Yields None as a heartbeat when nothing happened for `heartbeat` seconds.
        """
        index = max(since, 0)
        seen = {}
        while True:
            with self.cond:
                def pending():
                    fresh = index < self.base + len(self.events)
                    return fresh or any(seen.get(slot) != v for slot, v in self.versions.items())

                if not pending() and not self.closed:
                    self.cond.wait(heartbeat)
                index = max(index, self.base)
                batch = self.events[index - self.base:]
                index += len(batch)
                slots = [dict(value) for slot, value in self.latest.items() if seen.get(slot) != self.versions[slot]]
                for slot in slots:
                    seen[slot["type"]] = slot["version"]
                done = self.closed and index >= self.base + len(self.events)
            if not batch and not slots and not done:
                yield None
            yield from batch
            yield from slots
            if done:
                return
