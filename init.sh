#!/bin/bash

# Функции для цветного вывода
info() { echo -e "\033[1;34m$1\033[0m"; }
warn() { echo -e "\033[1;33m$1\033[0m"; }
error() { echo -e "\033[1;31m$1\033[0m"; }

# Проверка и создание .env файла
if [ ! -f .env ]; then
    info "Создаю .env файл из шаблона..."
    cp .env.example .env
    warn "Пожалуйста, отредактируйте .env файл и установите правильные значения"
fi

# Функция проверки установки пакета
check_package() {
    if command -v $1 &> /dev/null; then
        info "$1 уже установлен"
        return 0
    else
        warn "$1 не установлен"
        return 1
    fi
}

# Функция проверки установки npm пакета
check_npm_package() {
    if npm list -g $1 &> /dev/null; then
        info "npm пакет $1 уже установлен"
        return 0
    else
        warn "npm пакет $1 не установлен"
        return 1
    fi
}

# Функция проверки установки pip пакета
check_pip_package() {
    if pip show $1 &> /dev/null; then
        info "pip пакет $1 уже установлен"
        return 0
    else
        warn "pip пакет $1 не установлен"
        return 1
    fi
}

# Проверка системных зависимостей
info "Проверка системных зависимостей..."
SYSTEM_PACKAGES=("ffmpeg" "mpg123" "curl" "git" "python3" "python3-venv" "python3-pip" "alsa-utils")
for pkg in "${SYSTEM_PACKAGES[@]}"; do
    if ! check_package $pkg; then
        info "Установка $pkg..."
        sudo apt-get install -y $pkg
    fi
done

# Проверка Node.js и npm
info "Проверка Node.js и npm..."
if ! check_package node; then
    info "Установка Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if ! check_package npm; then
    info "Установка npm..."
    sudo apt-get install -y npm
fi

# Проверка виртуального окружения Python
info "Проверка виртуального окружения Python..."
if [ ! -d "venv" ]; then
    info "Создание виртуального окружения Python..."
    python3 -m venv venv
fi

# Активация виртуального окружения
source venv/bin/activate

# Проверка Python зависимостей
info "Проверка Python зависимостей..."
if ! check_pip_package open-interpreter; then
    info "Установка open-interpreter..."
    pip install open-interpreter
fi

# Проверка npm зависимостей
info "Проверка npm зависимостей..."
NPM_PACKAGES=("mic" "play-sound" "node-fetch" "form-data" "dotenv")
for pkg in "${NPM_PACKAGES[@]}"; do
    if ! check_npm_package $pkg; then
        info "Установка $pkg..."
        npm install $pkg
    fi
done

# Создание директории для аудио файлов
info "Проверка директории для аудио файлов..."
if [ ! -d "audio" ]; then
    info "Создание директории для аудио файлов..."
    mkdir -p audio
fi

# Загрузка переменных окружения
source .env

# Проверка порта
info "Проверка порта ${ZONOSJS_PORT:-5050}..."
if lsof -i :${ZONOSJS_PORT:-5050} &> /dev/null; then
    warn "Порт ${ZONOSJS_PORT:-5050} уже занят. Пожалуйста, освободите его или измените в .env"
    exit 1
fi

info "Запуск сервера..."
node index.js