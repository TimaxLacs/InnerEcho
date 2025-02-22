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

const execAsync = promisify(exec);

let executor;

const SAMPLE_RATE = 16000;
const SILENCE_TIMEOUT = 2000;
const TEMP_DIR = tmpdir();
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
  maxTokens: 100, // Увеличиваем до 100 для более длинных ответов
});

// Настройка агента (оставляем для возможного будущего использования)
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
  const tempOutputFile = path.join(TEMP_DIR, `converted_${Date.now()}.wav`);
  let ffmpegCommand;

  if (typeof audioBufferOrPath === 'string') {
    ffmpegCommand = `ffmpeg -i "${audioBufferOrPath}" -ar 16000 -ac 1 -f wav "${tempOutputFile}" -y`;
  } else {
    const tempInputFile = path.join(TEMP_DIR, `raw_${Date.now()}.pcm`);
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

// Получение ответа от DeepSeek в режиме стриминга
async function brainAppeal(text) {
  if (!text || text === "Ошибка: транскрипция не удалась") {
    return "Извините, не удалось распознать речь.";
  }

  console.log('Используем стриминг для ответа');
  const prompt = [
    { role: "system", content: "Отвечай кратко и по делу, без лишних рассуждений." },
    { role: "user", content: text }
  ];
  const stream = await llm.stream(prompt);
  let fullResponse = "";
  for await (const chunk of stream) {
    fullResponse += chunk.content;
    process.stdout.write(chunk.content);
  }
  console.log('\nСтриминг завершен');
  return fullResponse.trim();
}

// Синтез и воспроизведение ответа
async function voice(text) {
  const response = await fetch('https://api.goapi.ai/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GOAPI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice: "alloy",
      response_format: "mp3",
      speed: 1.3
    })
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const outputFile = path.join(TEMP_DIR, `response_${Date.now()}.mp3`);
  await fs.writeFile(outputFile, buffer);

  await new Promise((resolve, reject) => {
    player.play(outputFile, (err) => err ? reject(err) : resolve());
  });

  await fs.unlink(outputFile);
}

// Основной цикл с поддержкой стриминга
async function mainLoop() {
  await setupAgent();
  while (true) {
    try {
      const audio = "/workspace/InnerEcho/voice_sample.wav";
      // const audio = await listen(); // Раскомментируйте для реальной записи
      const text = await transcribe(audio);
      console.log('Транскрипция:', text);

      // Стриминг для любого текста
      const prompt = [
        { role: "system", content: "Отвечай кратко и по делу, без лишних рассуждений." },
        { role: "user", content: text }
      ];
      const stream = await llm.stream(prompt);
      let accumulatedText = "";
      for await (const chunk of stream) {
        accumulatedText += chunk.content;
        process.stdout.write(chunk.content);
        if (accumulatedText.length > 50) { // Отправляем на TTS каждые 50 символов
          await voice(accumulatedText);
          accumulatedText = "";
        }
      }
      console.log('\nСтриминг завершен');
      if (accumulatedText) await voice(accumulatedText); // Воспроизводим остаток

      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.error('Ошибка в главном цикле:', err);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

mainLoop().catch(console.error);