#!/bin/bash

# Универсальный скрипт для подготовки модели Zonos

# Определяем текущую директорию скрипта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Проверка и установка Python
echo "Проверка Python..."
if ! command -v python3 &> /dev/null; then
    echo "Python не найден, установка (требуются права sudo)..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update
        sudo apt-get install -y python3 python3-pip python3-venv
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew install python3
    else
        echo "Установите Python вручную для вашей системы (https://www.python.org/downloads/)"
        exit 1
    fi
else
    echo "Python уже установлен: $(python3 --version)"
fi

# Проверка и установка Git
echo "Проверка Git..."
if ! command -v git &> /dev/null; then
    echo "Git не найден, установка (требуются права sudo)..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update
        sudo apt-get install -y git
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew install git
    else
        echo "Установите Git вручную для вашей системы (https://git-scm.com/downloads)"
        exit 1
    fi
else
    echo "Git уже установлен: $(git --version)"
fi

# Создание и активация виртуальной среды
echo "Настройка виртуальной среды..."
if [ ! -d "zonos_env" ]; then
    python3 -m venv zonos_env
fi
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    source zonos_env/Scripts/activate
else
    source zonos_env/bin/activate
fi

# Обновление pip
echo "Обновление pip..."
pip install --upgrade pip

# Установка зависимостей
echo "Установка зависимостей..."
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install onnx
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    sudo apt-get install -y espeak
elif [[ "$OSTYPE" == "darwin"* ]]; then
    brew install espeak
fi
# На Windows eSpeak требует отдельной установки вручную: https://github.com/espeak-ng/espeak-ng

# Скачивание и настройка Zonos
echo "Скачивание репозитория Zonos..."
if [ ! -d "Zonos" ]; then
    git clone https://github.com/Zyphra/Zonos.git
else
    echo "Репозиторий Zonos уже существует, обновление..."
    cd Zonos
    git pull
    cd ..
fi

# Динамическая настройка PYTHONPATH
echo "Настройка PYTHONPATH..."
export PYTHONPATH=$PYTHONPATH:$SCRIPT_DIR/Zonos

# Проверка наличия WAV-файла
echo "Проверка voice_sample.wav..."
if [ ! -f "voice_sample.wav" ]; then
    echo "Файл voice_sample.wav не найден! Добавьте WAV-файл в $SCRIPT_DIR."
    echo "Скрипт завершён с предупреждением."
    exit 1
fi

# Проверка наличия prepare_zonos.py
echo "Проверка prepare_zonos.py..."
if [ ! -f "prepare_zonos.py" ]; then
    echo "Файл prepare_zonos.py не найден! Создайте его с кодом из инструкции."
    echo "Скрипт завершён с ошибкой."
    exit 1
fi

# Запуск подготовки модели
echo "Запуск подготовки модели Zonos..."
python prepare_zonos.py

# Проверка результатов
if [ -f "embedding_model.onnx" ] && [ -f "generation_model.onnx" ]; then
    echo "Успех! Файлы embedding_model.onnx и generation_model.onnx созданы в $SCRIPT_DIR."
else
    echo "Ошибка: ONNX-файлы не созданы. Проверьте вывод выше."
    exit 1
fi

echo "Готово!"