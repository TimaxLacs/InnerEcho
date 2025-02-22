#!/bin/bash

# Установка системных зависимостей
sudo apt update && sudo apt install -y ffmpeg mpg123 curl

# Установка Node.js (если не установлен)
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt install -y nodejs
fi

# Установка Node.js зависимостей
npm install mic play-sound @langchain/ollama @langchain/core langchain nodejs-whisper

npx nodejs-whisper download

# Установка Ollama, если не установлен
if ! command -v ollama &> /dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

# Загрузка модели DeepSeek
ollama pull deepseek-r1:1.5b

# Напоминание о запуске сервера Ollama
echo "Убедитесь, что сервер Ollama запущен командой 'ollama serve' перед запуском скрипта."