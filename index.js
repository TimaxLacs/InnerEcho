import { Transform } from 'node:stream';
import mic from 'mic';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';
import play from 'play-sound';
import { nodewhisper } from 'nodejs-whisper';
import { ChatOllama } from "@langchain/ollama";
import { createReactAgent } from "langchain/agents";
import { pull } from "langchain/hub";
import { AgentExecutor } from "langchain/agents";
import { DynamicTool } from "@langchain/core/tools";
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import ZonosJS from 'zonosjs';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import FormData from 'form-data';

// Загрузка переменных окружения
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
dotenv.config({ path: envPath });

// Проверка обязательных переменных окружения
const requiredEnvVars = [
  'OPEN_INTERPRETER_API_URL',
  'OPEN_INTERPRETER_API_KEY',
  'OPEN_INTERPRETER_MODEL',
  'DEEP_API_URL',
  'DEEP_TOKEN'
];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Ошибка: переменная окружения ${envVar} не установлена в .env файле`);
    process.exit(1);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

const SAMPLE_RATE = 16000;
const SILENCE_TIMEOUT = 2000;
const player = play({ players: ['mpg123'] });
const zonosClient = new ZonosJS();

// Получение списка аудиоустройств
async function getAudioDevices() {
  try {
    const { stdout } = await execAsync('ffmpeg -f alsa -list_devices true -i dummy 2>&1');
    const lines = stdout.split('\n');
    const inputs = [];
    const outputs = [];
    lines.forEach(line => {
      if (line.includes('[ALSA]') && line.includes('input')) {
        inputs.push(line.trim());
      } else if (line.includes('[ALSA]') && line.includes('output')) {
        outputs.push(line.trim());
      }
    });
    return { inputs, outputs };
  } catch (err) {
    console.error('Ошибка получения списка устройств:', err);
    return { inputs: ['default'], outputs: ['default'] };
  }
}

// Тестирование микрофона
async function testMicrophone(device = 'default') {
  console.log(`Тестируем микрофон: ${device}`);
  const micInstance = mic({
    rate: String(SAMPLE_RATE),
    channels: '1',
    device,
    format: 'S16_LE',
    debug: false,
    exitOnSilence: 0
  });

  const audioChunks = [];
  const vad = createVoiceDetector();
  const audioStream = micInstance.getAudioStream();

  audioStream.pipe(vad).on('data', chunk => audioChunks.push(chunk));

  vad.on('silence', () => micInstance.stop());
  audioStream.on('startComplete', () => console.log('Запись началась...'));
  audioStream.on('stopComplete', async () => {
    const audioBuffer = Buffer.concat(audioChunks);
    const testFile = path.join(__dirname, 'test_mic.wav');
    await fs.writeFile(testFile, audioBuffer);
    console.log(`Запись завершена, файл сохранён: ${testFile}`);
    await player.play(testFile, err => {
      if (err) console.error('Ошибка воспроизведения теста:', err);
      else console.log('Тест микрофона завершён');
    });
  });

  micInstance.start();
  await new Promise(resolve => setTimeout(resolve, 5000)); // Запись 5 секунд
  micInstance.stop();
}

// Настройка аудиоустройств
async function setupAudio() {
  const { inputs, outputs } = await getAudioDevices();
  console.log('Доступные микрофоны:', inputs);
  console.log('Доступные динамики:', outputs);

  // Выбор микрофона (по умолчанию первый или 'default')
  const selectedMic = inputs.length > 0 ? inputs[0].split(' ')[0] : 'default';
  console.log(`Выбран микрофон: ${selectedMic}`);
  await testMicrophone(selectedMic);

  // Выбор динамика (по умолчанию 'default')
  const selectedSpeaker = outputs.length > 0 ? outputs[0].split(' ')[0] : 'default';
  console.log(`Выбран динамик: ${selectedSpeaker}`);
  // Тест воспроизведения через play-sound не требует явного указания устройства,
  // так как mpg123 использует системный вывод по умолчанию

  return { micDevice: selectedMic, speakerDevice: selectedSpeaker };
}


// Кастомный инструмент для агента (заглушка)
const customTool = new DynamicTool({
  name: "semantic",
  description: "запрос к пакету семантики (заглушка)",
  func: async (input) => `Результат поиска для "${input}"`,
});


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
        silenceTimer = setTimeout(() => vad.emit('silence'), SILENCE_TIMEOUT);
      } else if (!silenceTimer) {
        silenceTimer = setTimeout(() => vad.emit('silence'), SILENCE_TIMEOUT);
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
async function listen(micDevice = 'default') {
  return new Promise((resolve, reject) => {
    const micInstance = mic({
      rate: String(SAMPLE_RATE),
      channels: '1',
      device: micDevice,
      format: 'S16_LE',
      debug: false,
      exitOnSilence: 0
    });

    const audioChunks = [];
    const vad = createVoiceDetector();
    const audioStream = micInstance.getAudioStream();

    audioStream
      .pipe(vad)
      .on('data', chunk => audioChunks.push(chunk))
      .on('error', reject);

    vad.on('silence', () => micInstance.stop());

    audioStream
      .on('startComplete', () => console.log('🎤 Слушаю...'))
      .on('stopComplete', () => resolve(Buffer.concat(audioChunks)));

    const timeout = setTimeout(() => {
      micInstance.stop();
      reject(new Error('Таймаут записи'));
    }, 30000);

    micInstance.start();
    audioStream.on('stopComplete', () => clearTimeout(timeout));
  });
}

// Конвертация аудио в WAV
async function convertToWav(audioInput) {
  const tempOutputFile = path.join(__dirname, `converted_${Date.now()}.wav`);
  let ffmpegCommand;

  if (typeof audioInput === 'string') {
    ffmpegCommand = `ffmpeg -i "${audioInput}" -ar 16000 -ac 1 -f wav "${tempOutputFile}" -y`;
  } else {
    const tempInputFile = path.join(__dirname, `raw_${Date.now()}.pcm`);
    await fs.writeFile(tempInputFile, audioInput);
    ffmpegCommand = `ffmpeg -f s16le -ar ${SAMPLE_RATE} -ac 1 -i "${tempInputFile}" -ar 16000 -ac 1 -f wav "${tempOutputFile}" -y`;
    await execAsync(ffmpegCommand);
    await fs.unlink(tempInputFile);
    return tempOutputFile;
  }

  try {
    await execAsync(ffmpegCommand);
    const durationCheck = await execAsync(`ffprobe -i "${tempOutputFile}" -show_entries format=duration -v quiet -of csv="p=0"`);
    const duration = parseFloat(durationCheck.stdout);
    if (duration < 1) {
      const paddedFile = path.join(__dirname, `padded_${Date.now()}.wav`);
      await execAsync(`ffmpeg -i "${tempOutputFile}" -af "apad=pad_dur=1" -ar 16000 -ac 1 "${paddedFile}" -y`);
      await fs.unlink(tempOutputFile);
      return paddedFile;
    }
    return tempOutputFile;
  } catch (err) {
    console.error('Ошибка конвертации:', err);
    throw err;
  }
}


async function transcribe(audioBuffer) {
  try {
    const formData = new FormData();
    formData.append("file", audioBuffer, "audio.wav");
    formData.append("model", "whisper-1");
    formData.append("language", "RU");

    const response = await fetch(`${process.env.DEEP_API_URL}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DEEP_TOKEN}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Ошибка HTTP: ${response.status} ${response.statusText}`);
    }

    const responseData = await response.json();
    return responseData.text || "Ошибка: транскрипция не удалась";
  } catch (err) {
    console.error('Ошибка транскрипции:', err);
    return "Ошибка: транскрипция не удалась";
  }
}

// Функция для взаимодействия с Open Interpreter
async function brainAppeal(text) {
  if (!text || text === "Ошибка: транскрипция не удалась") {
    return "Извините, не удалось распознать речь.";
  }
  console.log('Генерируем ответ через Open Interpreter...');
  
  return new Promise((resolve, reject) => {
    const interpreter = spawn('interpreter', [
      '--api-base', process.env.OPEN_INTERPRETER_API_URL,
      '--api-key', process.env.OPEN_INTERPRETER_API_KEY,
      '--model', process.env.OPEN_INTERPRETER_MODEL,
      '--os'
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    
    let response = '';
    let errorOutput = '';
    let timeout = setTimeout(() => {
      interpreter.kill();
      reject(new Error('Таймаут ожидания ответа от Open Interpreter'));
    }, 30000); // 30 секунд таймаут
    
    interpreter.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Open Interpreter:', output);
      response += output;
    });
    
    interpreter.stderr.on('data', (data) => {
      const error = data.toString();
      console.error('Ошибка Open Interpreter:', error);
      errorOutput += error;
    });
    
    interpreter.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Open Interpreter завершился с кодом ${code}. Ошибка: ${errorOutput}`));
      } else {
        // Очищаем ответ от технических сообщений
        const cleanResponse = response
          .replace(/^.*?\[.*?\].*?\n/gm, '') // Удаляем строки с квадратными скобками
          .replace(/^\s*$/gm, '') // Удаляем пустые строки
          .trim();
        resolve(cleanResponse || "Извините, не удалось получить ответ.");
      }
    });
    
    // Добавляем контекст для более точных ответов
    const prompt = `Ты - голосовой ассистент, использующий модель ${process.env.OPEN_INTERPRETER_MODEL}. 
Отвечай кратко и по делу, используя естественный разговорный стиль. 
Вопрос: ${text}`;
    interpreter.stdin.write(prompt + '\n');
    interpreter.stdin.end();
  });
}

async function voice(text) {
  try {
    const requestBody = {
      model: 'tts-1',
      input: text,
      voice: 'alloy'
    };

    const response = await fetch(`${process.env.DEEP_API_URL}/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DEEP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Ошибка HTTP: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
    }

    const audioBuffer = await response.buffer();
    const audioDir = path.join(__dirname, 'audio');
    await fs.mkdir(audioDir, { recursive: true }).catch(() => {});

    const outputFile = path.join(audioDir, `response_${Date.now()}.mp3`);
    await fs.writeFile(outputFile, audioBuffer);

    await new Promise((resolve, reject) => {
      player.play(outputFile, (err) => {
        if (err) {
          console.error('Ошибка воспроизведения:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    const tokenCost = response.headers.get('X-Token-Cost');
    if (tokenCost) {
      console.log(`[TTS] Использовано токенов: ${tokenCost}`);
    }
  } catch (error) {
    console.error('Ошибка в voice:', error.message);
  }
}

async function mainLoop() {
  try {
    const audioSetup = await setupAudio();
    const micDevice = audioSetup.micDevice;

    console.log('Ассистент готов к работе!');
    console.log('Нажмите Ctrl+C для выхода');
    console.log('Используемые настройки:');
    console.log(`- Open Interpreter URL: ${process.env.OPEN_INTERPRETER_API_URL}`);
    console.log(`- Open Interpreter модель: ${process.env.OPEN_INTERPRETER_MODEL}`);
    console.log(`- ZonosJS порт: ${process.env.ZONOSJS_PORT || 5050}`);

    while (true) {
      try {
        const audio = await listen(micDevice);
        const text = await transcribe(audio);
        console.log('Распознанный текст:', text);
        
        const response = await brainAppeal(text);
        console.log('Ответ:', response);
        
        await voice(response);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error('Ошибка в главном цикле:', err);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } catch (err) {
    console.error('Критическая ошибка:', err);
    process.exit(1);
  }
}

// Обработка завершения процесса
process.on('SIGINT', async () => {
  console.log('\nЗавершение работы...');
  try {
    await execAsync('pkill -f "npx zonosjs serve"');
    process.exit(0);
  } catch (err) {
    console.error('Ошибка при завершении:', err);
    process.exit(1);
  }
});

// Обработка необработанных исключений
process.on('uncaughtException', (err) => {
  console.error('Необработанное исключение:', err);
  process.exit(1);
});

mainLoop().catch(console.error);