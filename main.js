import vosk from 'vosk';
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

// Для __dirname в ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ... инициализация модели vosk ...
// const model = new vosk.Model('путь_к_модели');

// Путь к модели vosk (используйте свою модель, например mic_test/model)
const MODEL_PATH = path.join(__dirname, 'mic_test', 'model', 'vosk-model-small-ru-0.22');
const SAMPLE_RATE = 16000;

// Проверяем наличие модели
if (!fs.existsSync(MODEL_PATH)) {
    console.error('Модель vosk не найдена по пути:', MODEL_PATH);
    process.exit(1);
}

// Инициализация модели
vosk.setLogLevel(0);
const model = new vosk.Model(MODEL_PATH);

const ACTIVATION_WORD = 'джарвис';
const SILENCE_TIMEOUT = 1800; // мс после активации
let isActive = false;
let userQuery = '';
let silenceTimer = null;
let lastPartial = '';

const arecord = spawn('arecord', [
    '-f', 'S16_LE',
    '-r', String(SAMPLE_RATE),
    '-c', '1',
    '-D', 'plughw:0,7', // используйте своё рабочее устройство!
    '-t', 'raw'
], {
    stdio: ['ignore', 'pipe', 'pipe']
});

console.log('Голосовое управление запущено. Скажите: "джарвис ...ваша команда..."');

let audioBuffer = Buffer.alloc(0);
let recognizer = new vosk.Recognizer({model: model, sampleRate: SAMPLE_RATE});

arecord.stdout.on('data', (data) => {
    audioBuffer = Buffer.concat([audioBuffer, data]);
    while (audioBuffer.length >= SAMPLE_RATE / 8) {
        const chunk = audioBuffer.slice(0, SAMPLE_RATE / 8);
        audioBuffer = audioBuffer.slice(SAMPLE_RATE / 8);

        if (recognizer.acceptWaveform(chunk)) {
            const result = recognizer.result();
            if (result.text) {
                handleResult(result.text);
            }
        } else {
            const partial = recognizer.partialResult();
            if (partial.partial && partial.partial !== lastPartial) {
                lastPartial = partial.partial;
                handlePartial(partial.partial);
            }
        }
    }
});

arecord.stderr.on('data', (data) => {
    console.error('Ошибка arecord:', data.toString());
});

arecord.on('close', (code) => {
    console.log('arecord завершился с кодом:', code);
    process.exit(0);
});

function handleResult(text) {
    if (!text) return;

    if (!isActive) {
        // До активации просто выводим распознанный текст
        console.log('Распознано:', text);
        if (text.toLowerCase().includes(ACTIVATION_WORD)) {
            isActive = true;
            userQuery = '';
            console.log('🟢 Ключевое слово обнаружено! Говорите ваш запрос...');
            resetSilenceTimer();
        }
    } else {
        // После активации собираем запрос
        userQuery += ' ' + text;
        console.log('Текущий запрос:', userQuery);
        resetSilenceTimer();
    }
}

function handlePartial(partial) {
    if (!partial) return;

    if (!isActive) {
        // До активации просто выводим частичное распознавание
        // console.log('Частичное распознавание:', partial);
        if (partial.toLowerCase().includes(ACTIVATION_WORD)) {
            isActive = true;
            userQuery = '';
            console.log('🟢 Ключевое слово обнаружено! Говорите ваш запрос...');
            resetSilenceTimer();
        }
    } else {
        // После активации обновляем таймер тишины
        resetSilenceTimer();
    }
}

function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
        if (isActive && userQuery.trim()) {
            processUserQuery(userQuery.trim());
        }
        isActive = false;
        userQuery = '';
        console.log('🎤 Ожидание ключевого слова для активации...');
    }, isActive ? SILENCE_TIMEOUT : 100);
}

async function processUserQuery(query) {
    console.log('\n➡️ Финальный запрос:', query);
    await runMcpTest(query);
}

// Не даём Node.js завершиться, пока работает микрофон
process.stdin.resume();

// ... остальной код ...

// --- Тест микрофона (на основе mic_test/test_mic.js) ---
async function runMicTest() {
    console.log('Тест микрофона:');
    const micInstance = mic({
        rate: String(SAMPLE_RATE),
        channels: '1',
        debug: false,
        device: 'default'
    });

    const micInputStream = micInstance.getAudioStream();
    const outputFileStream = fs.createWriteStream('test_output.wav');

    micInputStream.pipe(outputFileStream);

    micInputStream.on('startComplete', () => {
        console.log('Запись с микрофона началась (5 секунд)...');
        setTimeout(() => {
            micInstance.stop();
        }, 5000);
    });

    micInputStream.on('stopComplete', () => {
        console.log('Запись завершена, файл сохранён как test_output.wav');
    });

    micInputStream.on('error', (err) => {
        console.error('Ошибка микрофона:', err);
    });

    micInstance.start();
    // Ждём завершения записи
    await new Promise(resolve => micInputStream.on('stopComplete', resolve));
}

// --- Тест обращения к MCP серверу (на основе test_open_interpreter.js) ---
async function runMcpTest(query) {
    // Оставляем только POST-запрос
    const urlPost = 'http://127.0.0.1:8000/chat';
    const responsePost = await fetch(urlPost, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query }),
    });
    const dataPost = await responsePost.json();
    console.log('POST /chat:', dataPost);

    const speakablePost = extractSpeakableFromResult(dataPost?.result);
    if (speakablePost) {
        console.log('Озвучиваемое сообщение:', speakablePost);
        await speakText(speakablePost);
    }
}

function extractSpeakableFromResult(result) {
    if (!Array.isArray(result)) return null;
    for (const item of result) {
        if (item.content) {
            const match = item.content.match(/\[SPEAKABLE\]([\s\S]*?)\[\/SPEAKABLE\]/i);
            if (match) return match[1].trim();
        }
    }
    return null;
}

async function speakText(text) {
    const API_URL = 'https://api.deep-foundation.tech/v1/audio/speech';
    const TOKEN = 'a97011fbcf360f10eb59084cee10912c';

    const requestBody = {
        model: 'tts-1',
        input: text,
        voice: 'nova'
    };

    const requestOptions = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    };

    try {
        const response = await fetch(API_URL, requestOptions);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Error HTTP: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
        }

        const buffer = await response.buffer();
        fs.writeFileSync('speech.mp3', buffer);

        const tokenCost = response.headers.get('X-Token-Cost');
        if (tokenCost) {
            console.log(`[TTS Client] Enegry: ${tokenCost}`);
        }

        // Воспроизвести mp3 (только для Linux, через mpg123)
        spawn('mpg123', ['speech.mp3'], { stdio: 'ignore' });

    } catch (error) {
        console.error('[TTS Client] Error:', error.message);
    }
}

// ... остальной код ...

process.on('SIGINT', () => {
    console.log('\nЗавершение...');
    arecord.kill();
    recognizer.free();
    model.free();
    process.exit(0);
}); 