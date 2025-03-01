import { Transform } from 'node:stream';
import mic from 'mic';
import fs from 'node:fs/promises';
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
import ZonosJS from 'zonosjs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

const SAMPLE_RATE = 16000;
const SILENCE_TIMEOUT = 2000;
const player = play({ players: ['mpg123'] });
const zonosClient = new ZonosJS();

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


async function convertToWav(audioInput) {
  const tempOutputFile = path.join(process.cwd(), `converted_${Date.now()}.wav`);
  let ffmpegCommand;

  if (typeof audioInput === 'string') {
    // Если входной параметр — путь к файлу
    ffmpegCommand = `ffmpeg -i "${audioInput}" -ar 16000 -ac 1 -f wav "${tempOutputFile}" -y`;
  } else {
    // Если входной параметр — буфер
    const tempInputFile = path.join(process.cwd(), `raw_${Date.now()}.pcm`);
    await fs.writeFile(tempInputFile, audioInput);
    ffmpegCommand = `ffmpeg -f s16le -ar ${SAMPLE_RATE} -ac 1 -i "${tempInputFile}" -ar 16000 -ac 1 -f wav "${tempOutputFile}" -y`;
    await execAsync(ffmpegCommand);
    await fs.unlink(tempInputFile);
    return tempOutputFile;
  }

  try {
    await execAsync(ffmpegCommand);
    // Проверяем длительность файла
    const durationCheck = await execAsync(`ffprobe -i "${tempOutputFile}" -show_entries format=duration -v quiet -of csv="p=0"`);
    const duration = parseFloat(durationCheck.stdout);
    if (duration < 1) {
      // Добавляем 1 секунду тишины в конец, если файл короче 1 секунды
      const paddedFile = path.join(process.cwd(), `padded_${Date.now()}.wav`);
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
  const wavFile = await convertToWav(audioBuffer);
  const textFile = `${wavFile}.txt`;
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
    if (result.text) return result.text;
    const transcribedText = await fs.readFile(textFile, 'utf8');
    return transcribedText.trim() || "Ошибка: транскрипция не удалась";
  } catch (err) {
    console.error('Ошибка транскрипции:', err);
    return "Ошибка: транскрипция не удалась";
  } finally {
    await fs.unlink(textFile).catch(() => {});
  }
}

// Получение ответа от DeepSeek
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

async function voice(text) {
  console.log('Начинаем генерацию речи для текста:', text);
  try {
    console.log('Отправляем запрос к ZonosJS...');
    const audioBuffer = await zonosClient.generateSpeech(text, './reference.wav', 'ru');
    console.log('Аудио получено, размер буфера:', audioBuffer.length);

    const audioDir = path.join(__dirname, 'audio');
    await fs.mkdir(audioDir, { recursive: true }).catch(() => {}); 

    const outputFile = path.join(audioDir, `response_${Date.now()}.wav`);
    console.log('Сохраняем файл:', outputFile);
    await fs.writeFile(outputFile, audioBuffer);
    console.log('Файл сохранён');

    console.log('Воспроизводим аудио...');
    await new Promise((resolve, reject) => {
      player.play(outputFile, (err) => {
        if (err) {
          console.error('Ошибка воспроизведения:', err);
          reject(err);
        } else {
          console.log('Воспроизведение завершено');
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('Ошибка в voice:', error.message);
  }
}

async function mainLoop() {
  await setupAgent();
  while (true) {
    try {
      const audio = await listen();
      // const audio = "/workspace/InnerEcho/reference.wav";
      const text = await transcribe(audio);
      console.log('Транскрипция:', text);
      const response = await brainAppeal(text);
      // const response = "привет"
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