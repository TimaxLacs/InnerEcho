#!/bin/bash

# Установка цветного вывода для логов
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Функции для логов
log() { echo -e "${GREEN}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

log "Установка системных зависимостей"
sudo apt update && sudo apt install -y ffmpeg mpg123 curl espeak-ng git python3-dev

log "Установка Node.js (если не установлен)"
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt install -y nodejs
fi

log "Установка JavaScript зависимостей..."
npm install mic play-sound @langchain/ollama @langchain/core langchain nodejs-whisper axios form-data

npx nodejs-whisper download

log "Настройка Python виртуального окружения"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv || error "Не удалось создать виртуальное окружение"
fi
source .venv/bin/activate

log "Установка uv (если не установлен)"
pip install -U uv

log "Клонирование и установка Zonos из GitHub"
if [ ! -d "Zonos" ]; then
  git clone https://github.com/Zyphra/Zonos.git || error "Не удалось клонировать Zonos"
fi
cd Zonos
uv pip install -e . || error "Не удалось установить Zonos"
uv pip install fastapi uvicorn torch torchaudio soundfile numpy langdetect || error "Не удалось установить зависимости Zonos"
cd ..

log "Проверка Ollama..."
if ! command -v ollama &> /dev/null; then
  log "Ollama не найден, устанавливаем..."
  curl -fsSL https://ollama.com/install.sh | sh || error "Не удалось установить Ollama"
else
  log "Ollama уже установлен: $(ollama --version)"
fi

log "Проверка работы Ollama сервера..."
if ! curl -s http://localhost:11434 > /dev/null; then
  log "Ollama сервер не запущен, запускаем в фоне..."
  nohup ollama serve > ollama.log 2>&1 &
  sleep 5 # Даем время серверу запуститься
  curl -s http://localhost:11434 > /dev/null || error "Не удалось запустить Ollama сервер"
else
  log "Ollama сервер уже работает"
fi

log "Проверка модели DeepSeek..."
if ! ollama list | grep -q "deepseek-r1:1.5b"; then
  log "Модель deepseek-r1:1.5b не найдена, загружаем..."
  ollama pull deepseek-r1:1.5b || error "Не удалось загрузить модель"
else
  log "Модель deepseek-r1:1.5b уже установлена"
fi

log "Настройка TTS сервера..."
if [ ! -f start_tts.sh ]; then
  echo '#!/bin/bash' > start_tts.sh
  echo 'source .venv/bin/activate' >> start_tts.sh
  echo 'uvicorn server:app --host 0.0.0.0 --port 5000' >> start_tts.sh
  chmod +x start_tts.sh
fi

if ! lsof -i :5000 > /dev/null; then
  log "Запускаем TTS сервер в фоне..."
  nohup ./start_tts.sh > tts.log 2>&1 &
  sleep 5
else
  log "TTS сервер уже работает на порту 5000"
fi

log "Настройка завершена!"