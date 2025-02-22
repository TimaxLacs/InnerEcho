#!/bin/bash

# Установка цветного вывода для логов
RED='\033[0;31m'
GREEN='\033[0;32m' 
NC='\033[0m' # No Color

# Функции для логов
log() { echo -e "${GREEN}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

log "Установка системных зависимостей"
sudo apt update && sudo apt install -y ffmpeg mpg123 curl

log "Установка Node.js (если не установлен)"
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt install -y nodejs
fi

log "Установка зависимостей..."
npm install mic play-sound @langchain/ollama @langchain/core langchain nodejs-whisper

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



log "Настройка завершена!"