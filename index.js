import { Transform } from 'node:stream';
import mic from 'mic';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import { ChatDeepSeek } from "@langchain/deepseek";
import play from 'play-sound';

const SAMPLE_RATE = 16000;
const SILENCE_TIMEOUT = 2000;
const TEMP_DIR = tmpdir();
const player = play({ players: ['mpg123'] });

const llm = new ChatDeepSeek({
  model: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY,
  temperature: 0.9,
});

function createVoiceDetector() {
  let silenceTimer = null;
  const vad = new Transform({
    transform(chunk, encoding, callback) {
      const energy = calculateEnergy(chunk);
      // console.log(`Energy level: ${energy.toFixed(4)}`);

      if (energy > 0.0005) { // Adjusted sensitivity
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          console.log('Обнаружена тишина, думаю...');
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
      .on('data', chunk => {
        audioChunks.push(chunk);
      })
      .on('error', reject);

    vad.on('silence', () => {
      // console.log('Stopping recording due to silence');
      micInstance.stop();
    });

    audioStream
      .on('startComplete', () => console.log('🎤 Слушаю...'))
      .on('stopComplete', () => {
        // console.log('Recording stopped');
        resolve(Buffer.concat(audioChunks));
      });

    const timeout = setTimeout(() => {
      micInstance.stop();
      reject(new Error('Recording timeout'));
    }, 30000);

    micInstance.start();

    audioStream.on('stopComplete', () => clearTimeout(timeout));
  });
}

async function transcribe(audioBuffer) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY_MIR,
    baseURL: `https://api.deep-foundation.tech/v1/`,
  });

  const tempFile = path.join(TEMP_DIR, `recording_${Date.now()}.wav`);
  await fs.promises.writeFile(tempFile, audioBuffer);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: "whisper-1",
      language: "ru",
    });
    return transcription.text;
  } finally {
    await fs.promises.unlink(tempFile);
  }
}

async function brainAppeal(text) {
  const response = await llm.invoke(text);
  return response.content;
}

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
  await fs.promises.writeFile(outputFile, buffer);

  await new Promise((resolve, reject) => {
    player.play(outputFile, (err) => err ? reject(err) : resolve());
  });

  await fs.promises.unlink(outputFile);
}

async function mainLoop() {
  while (true) {
    try {
      // console.log('🎤 Listening...');
      const audio = await listen();
      
      const text = await transcribe(audio);
      console.log('Transcription:', text);
      
      const response = await brainAppeal(text);
      console.log('AI Response:', response);
      
      await voice(response);
      
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.error('Error in main loop:', err);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

mainLoop().catch(console.error);