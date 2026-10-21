# SAARTHI - Advanced Visual Navigation Assistant

SAARTHI (सारथी - The Compassionate Guide) is an AI-powered assistive vision system designed to provide real-time, socially aware navigation for the visually impaired. Built with high-speed multimodal AI via **Google Gemini**, SAARTHI interprets environmental dynamics, recognizes interpersonal social intent, maintains long-term spatial memory, and offers micro-guidance.

---

## 🌟 Key Features

- **Social Intelligence & Intent Recognition**: Identifies social cues such as waving, smiling, or approaching behavior to discern whether someone wishes to interact or is merely passing by.
- **Long-Term Spatial Memory**: Constructs a persistent spatial memory ("Memory Palace") of known rooms and locations, enabling users to tag and revisit landmarks.
- **High-Precision Micro-Navigation**: Vector-based audio and visual guidance to direct hands directly to small targets (door handles, keyholes, buttons, switches).
- **Interactive Step-by-Step Task Guidance**: Conversational and visual verification for real-world tasks (e.g., preparing tea, identifying appliances, locating objects).
- **Sub-Second Real-Time Feedback**: Streaming video frame processing and two-way audio interaction over WebSockets with latency optimization and deduplicated speech feedback.
- **Progressive Web App (PWA)**: Designed for mobile devices and browsers with full touch gesture support, spatial audio, and screen reader accessibility.

---

## 🏗️ Architecture & Tech Stack

- **AI Core**: Google Gemini Flash Multimodal API (via `google-genai`)
- **Backend**: FastAPI, Uvicorn, Python 3.12+
- **Protocol**: Asynchronous WebSockets for low-latency streaming
- **Frontend**: Clean Vanilla JavaScript (ES Modules), Modern Responsive CSS, HTML5 Canvas/Video, Web Audio API
- **State Management**: Concurrent session tracking, global task recovery, and memory persistence

---

## 📂 Project Structure

```
saarthi/
├── app/
│   ├── routes/
│   │   ├── pages.py          # HTTP page endpoints
│   │   └── websocket.py      # Real-time WebSocket streaming pipeline
│   ├── services/
│   │   ├── processor.py      # Core Gemini multimodal vision & speech engine
│   │   ├── memory.py         # Long-term spatial location memory
│   │   ├── speech.py         # Anti-repetition & audio speech manager
│   │   └── tracking.py       # Object & motion telemetry tracker
│   ├── config.py             # Application settings & environment loader
│   ├── models.py             # Data models and session state classes
│   ├── prompts.py            # Optimized multimodal prompts
│   └── utils.py              # Text similarity, console formatting & helpers
├── static/
│   ├── css/                  # Modular responsive stylesheets
│   ├── js/                   # Frontend modules (audio, network, input, ui)
│   ├── images/               # PWA icons and graphic assets
│   ├── manifest.json         # PWA Manifest
│   └── sw.js                 # Service worker
├── templates/
│   └── index.html            # Main HUD & intelligence interface
├── .env.example              # Sample environment configuration
├── main.py                   # Application launch script
└── requirements.txt          # Python dependencies
```

---

## 🚀 Quickstart

### 1. Requirements
- Python 3.12 or higher
- A Google Gemini API Key ([Get one at Google AI Studio](https://aistudio.google.com/))

### 2. Installation
```bash
pip install -r requirements.txt
```

### 3. Environment Setup
Create a `.env` file from `.env.example`:
```env
GEMINI_KEY=your_gemini_api_key_here
LOG_LEVEL=INFO
MODEL_NAME=gemini-2.5-flash
```

### 4. Running the Application
```bash
python main.py
```
Open your browser to:
```
http://localhost:5000
```

---

## 🎮 Controls & Gestures
- **Double-Tap**: Start / Stop SAARTHI visual navigation
- **Long Press / Hold**: Activate microphone for voice query or task request
- **Shake Device**: Toggle Intelligence HUD telemetry overlay
