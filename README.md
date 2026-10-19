# VoiceNav 🎙️

**Speak a task. VoiceNav opens the right website and does it in a real Chrome browser.**

> "Find Samsung Galaxy S25, the least price one with 256 GB storage, on Amazon."

VoiceNav hears that, opens amazon.in, searches, scrolls the results, and opens the cheapest matching listing. In testing, that run took about 15 seconds.

VoiceNav is built on [Jev Ultrafast](https://github.com/browser-use/jev-ultrafast) by Browser Use × TypeSafe. It adds voice input, uses OpenRouter for every model, and can start on any website.

---

## How it works

```text
 🎙️ you speak ──► Fish Audio speech-to-text ──► task text
                                                   │
                         start website (amazon.in, wikipedia.org, a URL you said)
                                                   │
       ┌───────────────────────────────────────────▼──────────────────────────┐
       │  page ──► numbered list of buttons, links, fields on screen           │
       │       ──► Jev picks ONE operation + ONE element  (CLICK [7], …)       │
       │       ──► Chrome executes it ──► look again ──► repeat until DONE     │
       └───────────────────────────────────────────────────────────────────────┘
                 TYPE_TEXT only: a small LLM writes the words to type
```

| Part | What it does | Service |
| --- | --- | --- |
| Speech-to-text | Turns your recording into the task text | [Fish Audio](https://fish.audio) (`transcribe-1-pro`) |
| Jev | Chooses each next action from the elements on screen | [OpenRouter](https://openrouter.ai/typesafe/jev-1.14) (`typesafe/jev-1.14`) |
| Text helper | Writes the text to type, and picks the start website | OpenRouter (`inception/mercury-2.5`) |
| Browser Harness | Drives your Chrome over the DevTools protocol | Runs locally |

Jev never writes code, selectors or coordinates. It can only pick from elements that are really on the page, and every click is re-checked before it happens.

---

## What you need

- **Windows, macOS or Linux**
- **Python 3.12+** and **[uv](https://docs.astral.sh/uv/)** (Python package manager)
- **Google Chrome**
- **Git**
- An **OpenRouter API key** with a little credit: <https://openrouter.ai/keys>
- A **Fish Audio API key**: <https://fish.audio> → *API Keys*
- A **microphone**

---

## Setup

### 1. Install uv

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

macOS / Linux:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Close and reopen the terminal afterwards so `uv` is on your PATH.

### 2. Get the code

```bash
git clone https://github.com/kskkoushik/voicenav.git
cd voicenav
uv sync
```

### 3. Add your API keys

Copy the example settings file:

```bash
copy .env.example .env     # Windows
cp .env.example .env       # macOS / Linux
```

Open `.env` and paste your two keys:

```ini
OPENROUTER_API_KEY=sk-or-...
FISH_AUDIO_API_KEY=...
```

`.env` is git-ignored, so the keys stay on your computer. They are used only by the local server and never sent to the web page.

### 4. Let VoiceNav control Chrome

Pick **one** option.

**Option A: your normal Chrome** (uses your logins and cookies)

1. Open Chrome and go to `chrome://inspect/#remote-debugging`.
2. Tick **Allow remote debugging for this browser instance**.
3. On the first run, Chrome asks **"Allow remote debugging?"**. Click **Allow**.

**Option B: a separate Chrome just for the agent** (a clean profile with no logins; nothing to tick)

Windows (PowerShell):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9333 --user-data-dir="$env:LOCALAPPDATA\voicenav-chrome" --no-first-run
$env:BU_CDP_URL = "http://127.0.0.1:9333"
```

macOS:

```bash
open -na "Google Chrome" --args --remote-debugging-port=9333 --user-data-dir="$HOME/.voicenav-chrome" --no-first-run
export BU_CDP_URL=http://127.0.0.1:9333
```

Keep that Chrome window open. Set `BU_CDP_URL` in the same terminal you use for the next step.

### 5. Start VoiceNav

```bash
uv run voicenav
```

When the terminal prints `VoiceNav: http://127.0.0.1:8766`, open **<http://127.0.0.1:8766>** in your browser.

---

## Using it

### By voice

1. Make sure the dropdown says **Any website · from your task**.
2. Click **Speak task**. The first time, allow the microphone.
3. Say the task, then click **Stop & run**.
4. VoiceNav transcribes your words into the task box, picks the website, opens a fresh browser window and runs until it is done.

### By typing

Type the task in the box, then click **Start demo** and **Run automatically**. To go one step at a time, use **Choose next**, then **Execute choice**.

### Tips for good results

- **Name the site or paste a URL:** "on Amazon", "on Wikipedia", or `https://…`. Otherwise VoiceNav picks the best-known site for the task.
- **Regional sites follow your computer's region.** In India, "Amazon" means amazon.in. Say "amazon.com" to override.
- **Say where to stop,** for example "Open its product page" or "Stop when results are visible".
- **Add "Do not add to cart or buy"** to shopping tasks. The agent can click anything you could.
- **Fix misheard names before re-running.** If speech-to-text gets a name wrong, correct it in the task box and click **Start demo**.
- **Pause stops the run** after the current step.

### Other scenarios in the dropdown

| Scenario | Starts on |
| --- | --- |
| Any website · from your task | The site your task names, a URL in the task, or the best match |
| Google Flights · real web | google.com/travel/flights |
| Travel planner · fixture | A local practice page (no internet needed) |
| Reading room · fixture | A local practice page (no internet needed) |

### From the command line

```bash
# Type the task
uv run --env-file .env python examples/run.py --goal "Find the Wikipedia article about Gödel's incompleteness theorems"

# Use a recorded voice file (wav, mp3, webm, ogg, m4a)
uv run --env-file .env python examples/run.py --audio my-task.wav

# Choose the start page yourself
uv run --env-file .env python examples/run.py --url https://www.amazon.in --goal "Find a USB-C cable under ₹300"
```

---

## Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | *required* | Jev and the text helper |
| `FISH_AUDIO_API_KEY` | *required for voice* | Speech-to-text |
| `TYPESAFE_MODEL` | `jev-latest` | Jev version (`jev-latest` currently resolves to `typesafe/jev-1.14`) |
| `TEXT_MODEL` | `inception/mercury-2.5` | Any OpenRouter chat model for typing text |
| `TEXT_MODEL_REASONING` | `none` | `none` turns off the text model's reasoning, which is faster |
| `FISH_AUDIO_LANGUAGE` | `en` | Language hint for speech-to-text; leave empty to auto-detect |
| `TYPESAFE_DEMO_PORT` | `8766` | Port of the local web page (set it in the terminal, not `.env`) |
| `BU_CDP_URL` | *(unset)* | Use a separate Chrome (Option B; set it in the terminal) |

---

## Troubleshooting

| You see | Fix |
| --- | --- |
| `daemon default didn't come up` | Chrome isn't allowing remote control. Do [step 4](#4-let-voicenav-control-chrome), then press **Start demo** again. |
| The page loads but the buttons do nothing | An old server may still be running. Stop every `uv run voicenav` window (Ctrl+C) and start one again. |
| `Address already in use` / wrong behaviour on port 8766 | Another copy is running. Close it, or use another port: `$env:TYPESAFE_DEMO_PORT = "8767"; uv run voicenav` (PowerShell) or `TYPESAFE_DEMO_PORT=8767 uv run voicenav` (macOS/Linux). |
| **Speak task** does nothing / "Microphone access was blocked" | Click the icon to the left of the address bar, allow **Microphone** for `127.0.0.1`, and reload. |
| `Text helper returned no valid field value` | A one-off bad reply from the text model. Click **Run automatically** again. |
| `Dropdown execution was not confirmed` | The site draws its own menu over a real dropdown (for example Amazon's *Sort by*). Re-run, or rephrase the task without sorting. |
| `Jev needs OPENROUTER_API_KEY` / `Voice input needs FISH_AUDIO_API_KEY` | Check `.env` is in the project folder and the key names match exactly. |
| Run stops with **blocked** | Jev found no safe next step: a login wall, a CAPTCHA, or a name that doesn't exist on the page. Check the screenshot, adjust the task, and run again. |

---

## Limits and safety

- **It acts in a real browser.** With Option A it uses your logged-in accounts. Watch the run, and tell it what it must not do.
- **Not supported yet:** CAPTCHAs, iframes, shadow DOM, canvas apps, file uploads, and some custom dropdowns. These usually end in **blocked**.
- **`DONE` is the agent's own judgement.** Always look at the final page yourself.
- **Costs:** Jev bills input tokens only, and each decision costs a fraction of a cent. Speech-to-text is billed by Fish Audio per audio length. OpenRouter shows the exact cost of every request.

---

## Project layout

| File | Job |
| --- | --- |
| [`voicenav/agent.py`](voicenav/agent.py) | The agent loop: observe → choose → act → observe |
| [`voicenav/model.py`](voicenav/model.py) | Jev requests, the text helper, and start-site choice (all via OpenRouter) |
| [`voicenav/voice.py`](voicenav/voice.py) | Fish Audio speech-to-text |
| [`voicenav/browser.py`](voicenav/browser.py) | Chrome connection, safe execution, following newly opened tabs |
| [`voicenav/snapshot.js`](voicenav/snapshot.js) | Reads the visible page and its controls in one call |
| [`voicenav/questions.py`](voicenav/questions.py) | Instructions for Jev and the text helper |
| [`voicenav/demo.py`](voicenav/demo.py) | Local web server (port 8766) |
| [`voicenav/static/`](voicenav/static/) | The web page: task box, **Speak task**, live view |
| [`examples/run.py`](examples/run.py) | Command-line runner (`--goal`, `--audio`, `--url`) |

## Development

```bash
uv run ruff check .
uv run pytest                 # offline; no paid API calls
node --check voicenav/static/app.js
uv build
```

## What VoiceNav changes from Jev Ultrafast

- **Voice input** through Fish Audio, in the web page and with `--audio` on the command line.
- **One OpenRouter key** for Jev and the text helper, instead of a TypeSafe key plus a separate provider.
- **Any website:** the start site comes from the task.
- **New tabs are followed.** Links that open in a new tab, such as Amazon products, no longer stall the run.
- **Prices and other `aria-hidden` text that is visible on screen** now reach the model.
- **Fixes:**
  - Windows: files are read as UTF-8, and the agent uses its own window so screenshots work.
  - A slow first page load is waited for instead of observed as blank.
  - Text-model replies that end with stray Markdown fences are accepted.

## Credits and license

- Agent loop and inspector: [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) (MIT)
- Jev decision model: [TypeSafe](https://docs.typesafe.ai)
- Browser control: [Browser Harness](https://github.com/browser-use/browser-harness)
- Speech-to-text: [Fish Audio](https://docs.fish.audio/features/speech-to-text)

Released under the MIT License. See [LICENSE](LICENSE).
