const vosk = require('vosk');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const MODEL_PATH = path.join(__dirname, 'model/vosk-model-small-ru-0.22');
const SAMPLE_RATE = 16000;
const ACTIVATION_WORD = 'джарвис';
const SILENCE_TIMEOUT = 1000; // 1 секунда после активации
const PRE_ACTIVATION_TIMEOUT = 100; // 100мс до активации

if (!fs.existsSync(MODEL_PATH)) {
  console.error('Модель Vosk не найдена. Запустите ./download_model.sh для установки модели.');
  process.exit(1);
}

vosk.setLogLevel(0);
const model = new vosk.Model(MODEL_PATH);
let recognizer = new vosk.Recognizer({model: model, sampleRate: SAMPLE_RATE});
let isActive = false;
let userQuery = '';
let silenceTimer = null;
let lastPartial = '';

// Запускаем arecord для записи с микрофона
const arecord = spawn('arecord', [
  '-f', 'S16_LE',
  '-r', String(SAMPLE_RATE),
  '-c', '1',
  '-D', 'plughw:0,7', // Используем DMIC16kHz
  '-t', 'raw'
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

console.log('Инициализация микрофона...');

// Буфер для накопления аудиоданных
let audioBuffer = Buffer.alloc(0);

arecord.stdout.on('data', (data) => {
  // Добавляем новые данные в буфер
  audioBuffer = Buffer.concat([audioBuffer, data]);
  
  // Обрабатываем данные порциями по 2000 сэмплов (0.125 секунды)
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
});

console.log('🎤 Ожидание ключевого слова для активации...');

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
    console.log('Частичное распознавание:', partial);
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
  }, isActive ? SILENCE_TIMEOUT : PRE_ACTIVATION_TIMEOUT);
}

function processUserQuery(query) {
  console.log('\n➡️ Финальный запрос:', query);
  // Можно отправить в терминал, например:
  // spawn('bash', ['-c', query], { stdio: 'inherit' });
}

process.on('SIGINT', () => {
  console.log('\nЗавершение...');
  arecord.kill();
  recognizer.free();
  model.free();
  process.exit(0);
}); 