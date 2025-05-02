#!/bin/bash

# Создаем директорию для модели, если её нет
mkdir -p model

# Скачиваем модель
echo "Скачиваем модель Vosk для русского языка..."
wget https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip -O model/model.zip

# Распаковываем
echo "Распаковываем модель..."
unzip model/model.zip -d model/

# Удаляем архив
rm model/model.zip

echo "Модель успешно установлена!" 