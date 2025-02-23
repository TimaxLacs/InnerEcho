#!/bin/bash

# Установка системных зависимостей
sudo apt-get update
sudo apt-get install -y espeak-ng ffmpeg

# Установка uv для управления Python-зависимостями
pip install -U uv

# Клонирование репозитория Zonos
git clone https://github.com/Zyphra/Zonos.git
cd Zonos

# Создание и активация виртуальной среды через uv 
uv venv
source .venv/bin/activate

# Установка базовых зависимостей Zonos (без compile, чтобы избежать flash-attn)
uv pip install -e .

# Установка дополнительных библиотек для сервера в той же виртуальной среде
uv pip install flask soundfile numpy torch torchaudio

# Возвращение в исходную директорию и запуск сервера
cd ..
python server.py