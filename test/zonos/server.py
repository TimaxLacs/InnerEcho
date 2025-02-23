import io
import logging
import torch
import torchaudio
from zonos.model import Zonos
from zonos.conditioning import make_cond_dict
from fastapi import FastAPI, Form
from fastapi.responses import StreamingResponse
from functools import lru_cache
from langdetect import detect, DetectorFactory
from typing import Optional

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DetectorFactory.seed = 0
app = FastAPI()
DEVICE = "cpu"  # Замените на "cuda" для GPU
MODEL = Zonos.from_pretrained("Zyphra/Zonos-v0.1-transformer", device=DEVICE)

@lru_cache(maxsize=100)
def generate_speech_cached(text: str, language: str, speaker_embedding: Optional[str] = None):
    return generate_speech(text, language, speaker_embedding)

def generate_speech(text: str, language: str, speaker_embedding: Optional[str] = None):
    logger.info(f"Generating speech for text: {text}, language: {language}")
    cond_dict = make_cond_dict(text=text, speaker=speaker_embedding, language=language)
    conditioning = MODEL.prepare_conditioning(cond_dict)
    with torch.no_grad():
        codes = MODEL.generate(conditioning)
        wavs = MODEL.autoencoder.decode(codes).cpu()
    audio_buffer = io.BytesIO()
    torchaudio.save(audio_buffer, wavs[0], MODEL.autoencoder.sampling_rate, format="wav")
    audio_buffer.seek(0)
    logger.info("Speech generated successfully")
    return audio_buffer

@app.post("/tts")
async def tts_endpoint(
    text: str = Form(...), reference_audio_path: Optional[str] = Form(None),
    language: Optional[str] = Form(None)
):
    if not language:
        try:
            language = detect(text)
            logger.info(f"Detected language: {language}")
        except Exception as e:
            logger.warning(f"Language detection failed: {e}")
            language = "en-us"
    speaker_embedding = None
    if reference_audio_path:
        try:
            wav, sr = torchaudio.load(reference_audio_path, normalize=True)
            speaker_embedding = MODEL.make_speaker_embedding(wav, sr)
            logger.info(f"Speaker embedding generated from {reference_audio_path}")
        except Exception as e:
            logger.error(f"Failed to load reference audio: {e}")
            return {"error": "Failed to load reference audio"}
    try:
        audio_buffer = generate_speech_cached(text, language, speaker_embedding)
        return StreamingResponse(audio_buffer, media_type="audio/wav", 
                                 headers={"Content-Disposition": "attachment; filename=output.wav"})
    except Exception as e:
        logger.error(f"Speech generation failed: {e}")
        return {"error": "Speech generation failed"}