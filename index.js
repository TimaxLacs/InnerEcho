import { Transform, PassThrough } from 'node:stream'; // Use node: prefix for built-in modules
import mic from 'mic';
import fs from 'node:fs'; // Use node: prefix for built-in modules
import { promisify } from 'node:util'; // Use node: prefix for built-in modules
import { pipeline } from 'node:stream/promises'; // Use node: prefix for built-in modules
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import OpenAI from 'openai'; // Direct import, no destructuring needed
import play from 'sound-play';
import path from 'node:path'; // Use node: prefix for built-in modules
import { tmpdir } from 'node:os'; // Add node: prefix

// Настройка окружения
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_MIR });
const SAMPLE_RATE = 16000; // Частота дискретизации аудио
const SILENCE_TIMEOUT = 1500; // Таймаут тишины в миллисекундах
const TEMP_DIR = tmpdir();

/**
 * Инициализация компонентов системы
 */
// Инициализация языковой модели
// Инициализация системы памяти
// Создание агента с возможностью сохранения состояния

const llmWithCustomURL = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.9,
    configuration: {
      baseURL: "https://api.deep-foundation.tech/v1/",
    },
  });


/**
 * Обнаружение голосовой активности (VAD)
 */
function createVoiceDetector() {
  let lastVoiceTime = Date.now();
  let silenceTimer = null;

  // Трансформ-поток для анализа аудио
  return new Transform({
    transform(chunk, encoding, callback) {
      const energy = calculateEnergy(chunk);
      
      // Если обнаружена голосовая активность
      if (energy > 0.1) {
        lastVoiceTime = Date.now();
        if (silenceTimer) clearTimeout(silenceTimer);
      } else if (!silenceTimer) {
        // Запуск таймера при обнаружении тишины
        silenceTimer = setTimeout(() => {
          this.emit('silence');
          silenceTimer = null;
        }, SILENCE_TIMEOUT);
      }
      
      this.push(chunk);
      callback();
    }
  });

  // Расчет уровня энергии аудиосигнала
  function calculateEnergy(chunk) {
    let energy = 0;
    for (let i = 0; i < chunk.length; i += 2) {
      energy += Math.abs(chunk.readInt16LE(i));
    }
    return energy / (chunk.length / 2) / 32767;
  }
}

/**
 * Запись аудио до обнаружения тишины
 */
async function listen() {
  return new Promise((resolve, reject) => {
    // Инициализация микрофона
    const micInstance = mic({
        rate: String(SAMPLE_RATE),
        channels: '1',
        device: 'hw:Loopback,1,0', // Используем loopback устройство
        format: 'S16_LE',
        debug: true,
        recorder: 'arecord',
        endOnSilence: 0
      });
      

    const audioChunks = [];
    const vad = createVoiceDetector();

    // Обработка событий
    vad.on('silence', () => {
      micInstance.stop();
      resolve(Buffer.concat(audioChunks));
    });

    micInstance.getAudioStream()
      .on('data', chunk => audioChunks.push(chunk))
      .on('error', reject);

    // Запуск записи
    micInstance.start();
    console.log('Слушаю...');
  });
}

/**
 * Транскрипция аудио с помощью Whisper API
 */
async function transcribe(audioBuffer) {
  // Сохранение временного файла
  const tempFile = path.join(TEMP_DIR, `recording_${Date.now()}.wav`);
  await fs.promises.writeFile(tempFile, audioBuffer);

  // Отправка в API Whisper
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tempFile),
    model: "whisper-1",
    response_format: "text",
  });

  return transcription;
}

/**
 * Обработка запроса с помощью языковой модели
 */
async function brainAppeal(text, threadId = 'default') {
  // Вызов языковой модели с сохранением контекста
  const response = await llmWithCustomURL.invoke(
    { messages: [new HumanMessage(text)] },
    { configurable: { thread_id: threadId } }
  );

  return response.messages.slice(-1)[0].content;
}

/**
 * Синтез речи через TTS API
 */
async function voice(text) {
  // Генерация аудио через OpenAI
  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: "nova",
    input: text,
  });

  // Сохранение временного файла
  const outputFile = path.join(TEMP_DIR, `response_${Date.now()}.mp3`);
  const buffer = Buffer.from(await mp3.arrayBuffer());
  await fs.promises.writeFile(outputFile, buffer);

  // Воспроизведение аудио
  await play.play(outputFile);
}

/**
 * Основной цикл работы приложения
 */
async function activation(threadId = 'default') {
  try {
    while (true) {
      // 1. Запись аудио
      const audio = await listen();
      
      // 2. Транскрипция в текст
      const text = await transcribe(audio);
      console.log('Пользователь:', text);
      
      // 3. Обработка запроса
      const response = await brainAppeal(text, threadId);
      console.log('Система:', response);
      
      // 4. Озвучивание ответа
    //   await voice(response);
    }
  } catch (err) {
    console.error('Ошибка:', err);
  }
}

// Запуск приложения
activation().catch(console.error);