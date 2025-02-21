import * as ort from 'onnxruntime-node';
import fs from 'fs';
import wav from 'wav-encoder';
import { Tool } from 'langchain/tools';
import { AgentExecutor, ChatConversationalAgent } from 'langchain/agents';

// Загрузка ONNX-моделей
async function loadModels() {
    const generateSession = await ort.InferenceSession.create('./zonos_generate.onnx');
    const decoderSession = await ort.InferenceSession.create('./dac_autoencoder.onnx');
    return { generateSession, decoderSession };
}

// Генерация спикерского эмбеддинга (заглушка)
async function getSpeakerEmbedding(audioPath) {
    // Заглушка: тензор размера [1, 128]
    // В реальной реализации нужно обработать аудио через модель LDA
    const embedding = new Float32Array(128).fill(0);
    return new ort.Tensor('float32', embedding, [1, 128]);
}

// Генерация кодов из текста и спикерского эмбеддинга
async function generateCodes(generateSession, speakerEmbedding) {
    const feeds = { prefix_conditioning: speakerEmbedding };
    const results = await generateSession.run(feeds);
    return results.out_codes;
}

// Декодирование кодов в waveform
async function decodeCodes(decoderSession, codes) {
    const feeds = { codes: codes };
    const results = await decoderSession.run(feeds);
    return results.waveform;
}

// Сохранение waveform в WAV
async function saveWav(waveform, outputPath) {
    const audioData = {
        sampleRate: 44100,  // Установите правильный sample rate, если известно
        channelData: [new Float32Array(waveform.data)]
    };
    const buffer = await wav.encode(audioData);
    fs.writeFileSync(outputPath, buffer);
}

// Пользовательский инструмент LangChain для TTS
class TTSTool extends Tool {
    constructor(generateSession, decoderSession) {
        super();
        this.generateSession = generateSession;
        this.decoderSession = decoderSession;
        this.name = 'tts_tool';
        this.description = 'Generates audio from text and a voice sample using Zonos TTS model';
    }

    async _call(input) {
        const { text, audioPath } = input;

        // Получение спикерского эмбеддинга
        const speakerEmbedding = await getSpeakerEmbedding(audioPath);

        // Генерация кодов (текст пока игнорируется, так как Zonos использует только эмбеддинг)
        const codes = await generateCodes(this.generateSession, speakerEmbedding);

        // Декодирование в waveform
        const waveform = await decodeCodes(this.decoderSession, codes);

        // Сохранение результата
        await saveWav(waveform, 'output.wav');

        return 'Аудио успешно сгенерировано в output.wav';
    }
}

// Основная функция
async function main() {
    const { generateSession, decoderSession } = await loadModels();

    // Создание инструмента
    const ttsTool = new TTSTool(generateSession, decoderSession);

    // Создание агента LangChain
    const agent = ChatConversationalAgent.fromTools({
        tools: [ttsTool],
        model: null,  // Без LLM, только инструмент
        verbose: true
    });

    const executor = AgentExecutor.fromAgentAndTools({
        agent,
        tools: [ttsTool],
        verbose: true
    });

    // Запуск агента
    const result = await executor.run({
        text: 'Привет, мир!',  // Текст пока не используется напрямую
        audioPath: './voice_sample.wav'
    });

    console.log(result);
}

main().catch(console.error);