# InnerEcho

Voice AI assistant with local speech recognition, response generation, and voice-cloned audio output.

## Installation

```bash
chmod +x init.sh
./init.sh
```

## Usage

1. Run the assistant:
```bash
node index.js
```

- Lists and tests audio devices.
- Records voice to create `reference.wav`.
- Listens, transcribes, responds, and plays audio saved in `audio/`.

## Requirements
- Node.js 18+
- Python 3+
- `ffmpeg`, `mpg123`, `alsa-utils`
