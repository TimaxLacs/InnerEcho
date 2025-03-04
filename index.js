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

// Добавим новую функцию для работы с файлом накопления голоса
async function appendToVoiceReference(audioBuffer) {
  const voiceHistoryFile = path.join(__dirname, 'voice_history.wav');
  
  try {
    // Конвертируем новую запись в WAV
    const newRecordingWav = await convertToWav(audioBuffer);
    
    // Если файл истории не существует, просто копируем новую запись
    if (!await fs.access(voiceHistoryFile).then(() => true).catch(() => false)) {
      await fs.copyFile(newRecordingWav, voiceHistoryFile);
    } else {
      // Объединяем существующую историю с новой записью
      const tempFile = path.join(__dirname, `temp_${Date.now()}.wav`);
      await execAsync(`ffmpeg -i "concat:${voiceHistoryFile}|${newRecordingWav}" -acodec copy "${tempFile}"`);
      await fs.rename(tempFile, voiceHistoryFile);
    }
    
    // Очищаем временный файл
    await fs.unlink(newRecordingWav).catch(() => {});
    
  } catch (error) {
    console.error('Ошибка при обновлении истории голоса:', error);
  }
}

// Обновляем функцию voice для использования накопленной истории голоса
async function voice(text) {
  console.log('Начинаем генерацию речи для текста:', text);
  try {
    console.log('Отправляем запрос к ZonosJS...');
    const voiceHistoryFile = path.join(__dirname, 'voice_history.wav');
    
    // Используем накопленную историю голоса вместо одиночного reference.wav
    const audioBuffer = await zonosClient.generateSpeech(text, voiceHistoryFile, 'ru');
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

// Обновляем mainLoop для добавления новых записей в историю голоса
async function mainLoop() {
  await setupAgent();
  const audioSetup = await setupAudio();
  const micDevice = audioSetup.micDevice;

  while (true) {
    try {
      const audio = await listen();
      // Добавляем новую запись в историю голоса
      await appendToVoiceReference(audio);
      
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