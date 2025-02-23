import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

async function tts(text, referenceAudioPath = null, language = null) {
    const form = new FormData();
    form.append('text', text);
    if (referenceAudioPath) form.append('reference_audio_path', referenceAudioPath);
    if (language) form.append('language', language);

    try {
        const response = await axios.post('http://localhost:5000/tts', form, {
            headers: form.getHeaders(), responseType: 'arraybuffer'
        });
        fs.writeFileSync('output.wav', response.data);
        console.log('Аудио сохранено в output.wav');
    } catch (error) {
        console.error('Ошибка:', error.message);
    }
}

const args = process.argv.slice(2);
tts(args[0] || 'Привет, мир!', args[1] || null, args[2] || null);