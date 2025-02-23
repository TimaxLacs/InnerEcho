import { Transform } from 'node:stream';
import mic from 'mic';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import play from 'play-sound';
import { nodewhisper } from 'nodejs-whisper';
import { ChatOllama } from "@langchain/ollama";
import { createReactAgent } from "langchain/agents";
import { pull } from "langchain/hub";
import { AgentExecutor } from "langchain/agents";
import { DynamicTool } from "@langchain/core/tools";
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import axios from 'axios';
import FormData from 'form-data';

const execAsync = promisify(exec);

const SAMPLE_RATE = 16000;
const SILENCE_TIMEOUT = 2000;
const player = play({ players: ['mpg123'] });

// Кастомный инструмент для агента (заглушка)
const customTool = new DynamicTool({
  name: "custom_search",
  description: "Поиск информации (заглушка)",
  func: async (input) => {
    return `Результат поиска для "${input}": Здесь могла быть полезная информация`;
  },
});

// Инициализация модели DeepSeek через Ollama
const llm = new ChatOllama({
  model: "deepseek-r1:1.5b",
  baseUrl: "http://localhost:11434",
  temperature: 0.1,
});

let executor;

// Настройка агента
async function setupAgent() {
  const prompt = await pull("hwchase17/react");
  const agent = await createReactAgent({
    llm,
    tools: [customTool],
    prompt,
  });
  executor = AgentExecutor.fromAgentAndTools({
    agent,
    tools: [customTool],
    handleParsingErrors: true,
  });
}

// Детектор активности голоса (VAD)
function createVoiceDetector() {
  let silenceTimer = null;
  const vad = new Transform({
    transform(chunk, encoding, callback) {
      const energy = calculateEnergy(chunk);
      if (energy > 0.0005) {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          vad.emit('silence');
        }, SILENCE_TIMEOUT);
      } else if (!silenceTimer) {
        silenceTimer = setTimeout(() => {
          vad.emit('silence');
        }, SILENCE_TIMEOUT);
      }
      this.push(chunk);
      callback();
    }
  });

  function calculateEnergy(chunk) {
    let energy = 0;
    for (let i = 0; i < chunk.length; i += 2) {
      energy += Math.abs(chunk.readInt16LE(i));
    }
    return energy / (chunk.length / 2) / 32767;
  }

  return vad;
}

// Слушаем микрофон
async function listen() {
  return new Promise((resolve, reject) => {
    const micInstance = mic({
      rate: String(SAMPLE_RATE),
      channels: '1',
      device: 'default',
      format: 'S16_LE',
      debug: false,
      exitOnSilence: 0
    });

    const audioChunks = [];
    const vad = createVoiceDetector();
    const audioStream = micInstance.getAudioStream();

    audioStream
      .pipe(vad)
      .on('data', chunk => {
        audioChunks.push(chunk);
      })
      .on('error', reject);

    vad.on('silence', () => {
      micInstance.stop();
    });

    audioStream
      .on('startComplete', () => console.log('🎤 Слушаю...'))
      .on('stopComplete', () => {
        resolve(Buffer.concat(audioChunks));
      });

    const timeout = setTimeout(() => {
      micInstance.stop();
      reject(new Error('Таймаут записи'));
    }, 30000);

    micInstance.start();

    audioStream.on('stopComplete', () => clearTimeout(timeout));
  });
}

// Конвертация аудио в WAV
async function convertToWav(audioBufferOrPath) {
  const tempOutputFile = path.join(process.cwd(), `converted_${Date.now()}.wav`);
  let ffmpegCommand;

  if (typeof audioBufferOrPath === 'string') {
    ffmpegCommand = `ffmpeg -i "${audioBufferOrPath}" -ar 16000 -ac 1 -f wav "${tempOutputFile}" -y`;
  } else {
    const tempInputFile = path.join(process.cwd(), `raw_${Date.now()}.pcm`);
    await fs.writeFile(tempInputFile, audioBufferOrPath);
    ffmpegCommand = `ffmpeg -f s16le -ar ${SAMPLE_RATE} -ac 1 -i "${tempInputFile}" -ar 16000 -ac 1 -f wav "${tempOutputFile}" -y`;
    await execAsync(ffmpegCommand);
    await fs.unlink(tempInputFile);
    return tempOutputFile;
  }

  await execAsync(ffmpegCommand);
  return tempOutputFile;
}

// Транскрипция аудио с помощью локальной модели Whisper
async function transcribe(audioBufferOrPath) {
  const wavFile = await convertToWav(audioBufferOrPath);
  const textFile = `${wavFile}.txt`; // Файл, куда Whisper сохраняет результат
  try {
    const result = await nodewhisper(wavFile, {
      modelName: 'base',
      autoDownloadModelName: 'base',
      removeWavFileAfterTranscription: true,
      whisperOptions: {
        outputInText: true,
        language: 'ru',
      },
    });
    if (result.text) {
      return result.text;
    }
    const transcribedText = await fs.readFile(textFile, 'utf8');
    return transcribedText.trim() || "Ошибка: транскрипция не удалась";
  } catch (err) {
    console.error('Ошибка транскрипции:', err);
    return "Ошибка: транскрипция не удалась";
  } finally {
    await fs.unlink(textFile).catch(() => {});
  }
}

// Получение ответа от агента DeepSeek
async function brainAppeal(text) {
  if (!text || text === "Ошибка: транскрипция не удалась") {
    return "Извините, не удалось распознать речь.";
  }

  console.log('Генерируем ответ...');
  const prompt = [
    { role: "system", content: "Отвечай кратко и по делу, без лишних рассуждений." },
    { role: "user", content: text }
  ];
  const response = await llm.invoke(prompt);
  return response.content;
}

// Синтез и воспроизведение ответа через локальный TTS-сервер
async function voice(text) {
  const form = new FormData();
  form.append('text', text);
  form.append('reference_audio_path', 'reference.wav'); // Файл с образцом вашего голоса

  try {
    const response = await axios.post('http://localhost:5000/tts', form, {
      headers: form.getHeaders(),
      responseType: 'arraybuffer'
    });
    const buffer = Buffer.from(response.data);
    const outputFile = path.join(process.cwd(), `response_${Date.now()}.wav`); // Сохранение в текущей директории
    await fs.writeFile(outputFile, buffer);

    await new Promise((resolve, reject) => {
      player.play(outputFile, (err) => err ? reject(err) : resolve());
    });

    console.log(`Аудиофайл сохранен: ${outputFile}`);
    // Файл не удаляется
  } catch (error) {
    console.error('Ошибка при генерации речи:', error.message);
  }
}

// Основной цикл
async function mainLoop() {
  await setupAgent();
  while (true) {
    try {
      // Для тестов используем заглушку
      // const audio = "/workspace/InnerEcho/test/audio_2025-02-22_09-29-56.wav"; // Замените на ваш файл
      const audio = await listen(); // Раскомментируйте для реальной записи
      const text = await transcribe(audio);
      console.log('Транскрипция:', text);
      const response = await brainAppeal(text);
      console.log('Ответ AI:', response);
      await voice(response);
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.error('Ошибка в главном цикле:', err);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

mainLoop().catch(console.error);