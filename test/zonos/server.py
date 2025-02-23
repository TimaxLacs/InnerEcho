import os
import io
import torch
import torchaudio
from zonos.model import Zonos
from zonos.conditioning import make_cond_dict
import soundfile as sf
from flask import Flask, request, send_file

app = Flask(__name__)

# Путь для временных файлов
TEMP_DIR = "/tmp"

# Установка устройства и загрузка модели при старте
DEVICE = "cpu"  # Замените на "cuda" для GPU
MODEL = Zonos.from_pretrained("Zyphra/Zonos-v0.1-transformer", device=DEVICE)

def generate_speech(text, reference_audio_path=None):
    """
    Генерация речи с использованием zyphra/zonos.
    Модель загружена глобально, что ускоряет обработку.
    """
    output_path = os.path.join(TEMP_DIR, "output.wav")
    
    if reference_audio_path and os.path.exists(reference_audio_path):
        # Быстрая загрузка референсного аудио
        wav, sampling_rate = torchaudio.load(reference_audio_path, normalize=True)
        speaker = MODEL.make_speaker_embedding(wav, sampling_rate)
        
        # Подготовка условий для синтеза с клонированием
        cond_dict = make_cond_dict(text=text, speaker=speaker, language="ru")
    else:
        # Синтез без клонирования
        cond_dict = make_cond_dict(text=text, language="ru")
    
    # Подготовка и генерация
    conditioning = MODEL.prepare_conditioning(cond_dict)
    with torch.no_grad():  # Отключаем градиенты для скорости
        codes = MODEL.generate(conditioning)
        wavs = MODEL.autoencoder.decode(codes).cpu()
    
    # Минимизация операций с диском: пишем напрямую в память
    audio_buffer = io.BytesIO()
    torchaudio.save(audio_buffer, wavs[0], MODEL.autoencoder.sampling_rate, format="wav")
    audio_buffer.seek(0)
    
    return audio_buffer

@app.route('/tts', methods=['POST'])
def tts_endpoint():
    text = request.form.get('text')
    reference_audio_path = request.form.get('reference_audio_path')
    
    if not text:
        return "Text is required", 400
    
    # Генерация аудио
    audio_buffer = generate_speech(text, reference_audio_path)
    
    # Отправка без лишних копирований
    return send_file(audio_buffer, mimetype='audio/wav', as_attachment=True, download_name='output.wav')

if __name__ == '__main__':
    os.makedirs(TEMP_DIR, exist_ok=True)
    # Увеличиваем производительность Flask с помощью gunicorn
    print("Сервер запущен на http://0.0.0.0:5000")
    app.run(host='0.0.0.0', port=5000, threaded=True)  # threaded=True для параллельных запросов 