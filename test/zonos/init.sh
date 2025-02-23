#!/bin/bash

sudo apt-get update
sudo apt-get install -y espeak-ng ffmpeg
pip install -U uv
git clone https://github.com/Zyphra/Zonos.git
cd Zonos
uv venv
source .venv/bin/activate
uv pip install -e .
uv pip install fastapi uvicorn torch torchaudio soundfile numpy langdetect
cd ..
uvicorn server:app --host 0.0.0.0 --port 5000