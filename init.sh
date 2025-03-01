#!/bin/bash

# Установка цветного вывода для логов
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Функции для логов
log() { echo -e "${GREEN}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

log "Установка системных зависимостей"
sudo apt update && sudo apt install -y ffmpeg mpg123 curl git python3 python3-venv python3-pip

log "Установка Node.js (если не установлен)"
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt install -y nodejs
fi

log "Установка JavaScript зависимостей..."
npm install mic play-sound @langchain/ollama @langchain/core langchain nodejs-whisper zonosjs

npx nodejs-whisper download

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
  sleep 5
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

log "Запуск сервера ZonosJS на порту 5050..."
if lsof -i :5050 > /dev/null; then
  log "Порт 5050 уже занят. Пожалуйста, освободите порт или выберите другой."
  exit 1
fi

log "Запускаем сервер ZonosJS в фоне на порту 5050..."
nohup npx zonosjs serve --port 5050 > zonosjs.log 2>&1 &
SERVER_PID=$!

# Параметры ожидания
MAX_WAIT=60
WAIT_INTERVAL=2
elapsed=0

# Цикл проверки состояния сервера
while [ $elapsed -lt $MAX_WAIT ]; do
  if grep -q "Uvicorn running on http://0.0.0.0:5050" zonosjs.log; then
    log "Сервер ZonosJS успешно запущен на порту 5050."
    break
  elif grep -q "ERROR" zonosjs.log || grep -q "address already in use" zonosjs.log; then
    log "Обнаружена ошибка при запуске сервера. Проверьте zonosjs.log"
    kill $SERVER_PID
    exit 1
  fi
  sleep $WAIT_INTERVAL
  elapsed=$((elapsed + WAIT_INTERVAL))
done

if [ $elapsed -ge $MAX_WAIT ]; then
  log "Сервер ZonosJS не запустился за $MAX_WAIT секунд. Проверьте zonosjs.log"
  kill $SERVER_PID
  exit 1
fi

log "Настройка завершена! Запустите ассистента командой: node index.js"