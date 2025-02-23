import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

async function tts(text, referenceAudioPath) {
    const form = new FormData();
    form.append('text', text);
    if (referenceAudioPath) {
        form.append('reference_audio_path', referenceAudioPath); // Передаем путь к файлу
    }

    try {
        const response = await axios.post('http://localhost:5000/tts', form, {
            headers: form.getHeaders(),
            responseType: 'arraybuffer'
        });
        
        // Сохранение результата
        fs.writeFileSync('output.wav', response.data);
        console.log('Аудио сохранено в output.wav');
    } catch (error) {
        console.error('Ошибка:', error.message);
    }
}

// Использование через командную строку ffmpeg -i voice_sample.wav -ac 1 -ar 22050 zonos/reference.wav
const args = process.argv.slice(2);
const text = args[0] || 'Привет, мир! Меня зовут Тимур. Я - это ты.';
const referenceAudioPath = args[1];

tts(text, referenceAudioPath);