import { Transform, PassThrough } from 'node:stream'; // Use node: prefix for built-in modules
import mic from 'mic';
import fs from 'node:fs'; // Use node: prefix for built-in modules
import { promisify } from 'node:util'; // Use node: prefix for built-in modules
import { pipeline } from 'node:stream/promises'; // Use node: prefix for built-in modules
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import OpenAI from 'openai';
import { ChatDeepSeek } from "@langchain/deepseek";
// import play from 'sound-play';
import path from 'node:path'; // Use node: prefix for built-in modules
import { tmpdir } from 'node:os'; // Add node: prefix
import FormData from 'form-data';
import { MemorySaver } from '@langchain/langgraph';
import request from 'request';
import play from 'play-sound';

const memory = new MemorySaver();

 
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY_MIR,
//   baseURL: `https://api.deep-foundation.tech/v1/`,
// });
const SAMPLE_RATE = 16000; // Частота дискретизации аудио
const SILENCE_TIMEOUT = 600; // Таймаут тишины в миллисекундах
const TEMP_DIR = tmpdir();
const player = play({ players: ['mpg123'] });


// const llm = new ChatOpenAI({
//   model: "gpt-4o-mini",
//   temperature: 0.9,
//   configuration: {
//     baseURL: "https://api.deep-foundation.tech/v1/",
//   },
//   formatResponse: (response) => ({
//     content: response.choices[0].message.content,
//     additional_kwargs: {}
//   })
// });





const llm = new ChatDeepSeek({
  model: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY,
  temperature: 0.9,
  // formatResponse: (response) => ({
  //   content: response.choices[0].message.content,
  //   additional_kwargs: {}
  // })
});

function createVoiceDetector() {
  let silenceTimer = null;
  const vad = new Transform({
    transform(chunk, encoding, callback) {
      const energy = calculateEnergy(chunk);
      console.log(`Уровень энергии: ${energy.toFixed(4)}`);

      if (energy > 0.05) { // Понижаем порог для теста
        if (silenceTimer) clearTimeout(silenceTimer);
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

/**
 * Запись аудио до обнаружения тишины
 */
async function listen() {
  return new Promise((resolve, reject) => {
    const micInstance = mic({
      rate: String(SAMPLE_RATE),
      channels: '1',
      device: 'default',
      format: 'S16_LE',
      debug: true,
      recorder: 'sox',
      silence: 2,
      threshold: 0.5,
      exitOnSilence: 0
    });

    const audioChunks = [];
    const vad = createVoiceDetector();
    const audioStream = micInstance.getAudioStream();

    // Обработчики событий для audioStream вместо micInstance
    audioStream
      .on('startComplete', () => console.log('Запись начата'))
      .on('data', chunk => audioChunks.push(chunk))
      .on('error', reject)
      .on('stopComplete', () => {
        clearTimeout(timeout);
        console.log('Запись остановлена');
        resolve(Buffer.concat(audioChunks));
      });

    vad.on('silence', () => {
      console.log('VAD: Обнаружена тишина');
      micInstance.stop();
    });

    const timeout = setTimeout(() => {
      console.log('Таймаут записи');
      micInstance.stop();
    }, 10000);

    micInstance.start();
  });
}

async function transcribe(audioBuffer) {
  try {
    // Создаем OpenAI клиент
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY_MIR,
      baseURL: `https://api.deep-foundation.tech/v1/`,
    });

    // Создаем временный файл
    const tempFile = path.join(TEMP_DIR, `recording_${Date.now()}.wav`);
    await fs.promises.writeFile(tempFile, audioBuffer);

    // Читаем аудиофайл как ReadableStream
    const audioFileStream = fs.createReadStream(tempFile);

    // Отправляем файл на транскрибацию
    const transcription = await openai.audio.transcriptions.create({
      file: audioFileStream,
      model: "whisper-1",
      language: "ru",
    });

    // Удаляем временный файл после использования
    await fs.promises.unlink(tempFile);

    // Возвращаем текст транскрипции
    return transcription.text;
  } catch (error) {
    console.error("Transcription error:", error);
  }
}



async function brainAppeal(text, threadId = 'default') {
  try {
    // const checkpoint = await memory.get({ configurable: { thread_id: threadId } });
    
    const messages = [
      ...[],
      new HumanMessage(text)
    ];
    const response = await llm.invoke(text);
    // Сохраняем обновленный контекст
    // await memory.put({
    //   configurable: { thread_id: threadId },
    //   messages: [
    //     ...messages,
    //     new AIMessage(response.content)
    //   ]
    // });

    return response.content;
  } catch (err) {
    console.error('Ошибка обработки запроса:', err);
    throw err;
  }
}

export async function voice(text) {
  try {
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
        speed: 1.0
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const outputFile = path.join(TEMP_DIR, `response_${Date.now()}.mp3`);
    await fs.promises.writeFile(outputFile, buffer);

    // Воспроизведение аудиофайла с использованием выбранного плеера
    await new Promise((resolve, reject) => {
      player.play(outputFile, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Удаление временного файла после воспроизведения
    await fs.promises.unlink(outputFile);
  } catch (error) {
    console.error('Ошибка генерации речи:', error);
    throw error;
  }
}


async function activation(threadId = 'default') {
  try {
    while (true) {
      const audio = await listen();
      console.log('Запись завершена, размер:', audio.length, 'байт');
      
      const text = await transcribe(audio);
      console.log('Транскрипция:', text);
      
      const response = await brainAppeal(text, threadId);
      console.log('Ответ:', response);
      
      await voice(response);
      
      // Добавляем задержку перед следующей итерацией
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error('Критическая ошибка:', err);
  }
}

// Запуск приложения
activation().catch(console.error);