from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import uvicorn

# Устанавливаем переменные окружения прямо в коде
os.environ["OPENAI_API_KEY"] = "f4887f0f766dff86058c4694dc2fe1ab"
os.environ["MODEL"] = "gpt-4o"
os.environ["API_BASE"] = "https://api.deep-foundation.tech/v1/"
os.environ["CONTEXT_WINDOW"] = "3000"
os.environ["MAX_TOKENS"] = "1000"

from interpreter import interpreter

# Настройка Open Interpreter из переменных окружения
interpreter.llm.api_key = os.environ["OPENAI_API_KEY"]
interpreter.llm.model = os.environ["MODEL"]
interpreter.llm.api_base = os.environ["API_BASE"]
interpreter.llm.context_window = int(os.environ["CONTEXT_WINDOW"])
interpreter.llm.max_tokens = int(os.environ["MAX_TOKENS"])
interpreter.auto_run = True

app = FastAPI(title="Open Interpreter MCP Server")

# Разрешаем CORS для всех (можно ограничить при необходимости)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def make_speakable_summary(full_text):
    # Берём первое предложение или первые 100 символов
    if not full_text:
        return ""
    sentence = full_text.split('.')[0]
    if len(sentence) < 10:
        # Если первое предложение слишком короткое, берём до 100 символов
        return full_text[:100]
    return sentence.strip() + '.'

@app.get("/")
async def root():
    return {"message": "Open Interpreter MCP Server is running"}

@app.get("/chat")
async def chat_endpoint(message: str):
    if not message:
        raise HTTPException(status_code=400, detail="Message parameter is required")
    try:
        message = f"это запрос пользователя {message}. выполни его запрос и сделай короткий лаконичный ответ, который удовлетворит пользователя в плане содержания и будет удобен для прослушивания, ВЫДЕЛИВ ЕГО ТАКИМ ОБРАЗОМ: [SPEAKABLE]*короткий ответ*[/SPEAKABLE]"
        result = interpreter.chat(message)
        # result — это список сообщений, модифицируем content каждого assistant-сообщения
        # for item in result:
        #     if item.get("role") == "assistant" and "content" in item:
        #         short_answer = make_speakable_summary(item["content"])
        #         item["content"] += f"\n[SPEAKABLE]{short_answer}[/SPEAKABLE]"
        return {"result": result}
    except Exception as e:
        return {"error": str(e)}

@app.post("/chat")
async def chat_post(data: dict = Body(...)):
    message = data.get("message")
    if not message:
        raise HTTPException(status_code=400, detail="Message parameter is required")
    try:
        message = f"это запрос пользователя {message}. выполни его запрос и сделай короткий лаконичный ответ, который удовлетворит пользователя в плане содержания и будет удобен для прослушивания, ВЫДЕЛИВ ЕГО ТАКИМ ОБРАЗОМ: [SPEAKABLE]*короткий ответ*[/SPEAKABLE]"
        result = interpreter.chat(message)
        # for item in result:
        #     if item.get("role") == "assistant" and "content" in item:
        #         short_answer = make_speakable_summary(item["content"])
        #         item["content"] += f"\n[SPEAKABLE]{short_answer}[/SPEAKABLE]"
        return {"result": result}
    except Exception as e:
        return {"error": str(e)}

@app.get("/history")
async def history_endpoint():
    return {"messages": interpreter.messages}

@app.post("/reset")
async def reset_chat():
    interpreter.messages = []
    return {"message": "Chat history has been reset"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

# ... остальной код ... 